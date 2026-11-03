import { SOL_MINT, solToLamports, lamportsToSol } from './config.js';
import { checkMarket, scoreCandidate, exitDecision, roundtripLossPct } from './strategy.js';
import { evaluateShield } from './safety.js';
import { sleep, fmtPct, fmtSol, shortMint } from './util.js';

/**
 * The trading engine. All I/O comes in through `deps` so it can be tested offline.
 *  deps: cfg, jup, market, trader, store, log, checkMint(mint), checkRug(mint), getSolBalance(), now()
 */
export function createBot(deps) {
  const { cfg, jup, market, trader, store, log } = deps;
  const now = deps.now ?? Date.now;
  const feeEst = solToLamports(cfg.feeEstimateSol);
  const tradeLamports = solToLamports(cfg.tradeSizeSol);
  const reserveLamports = solToLamports(cfg.minSolReserve);

  const watch = new Map(); // mint -> { addedAt, source }
  const blacklist = new Map(); // mint -> reason (failed a safety check)
  const lastEval = new Map(); // mint -> time of last deep check
  const cooldown = new Map(); // mint -> no re-entry before this time
  const busy = new Set(); // mints with a buy/sell in flight
  let pauseUntil = 0;
  let stopping = false;
  let lastGateMsg = '';

  // ---------- gates ----------
  function canOpen() {
    store.rollDay();
    if (stopping) return { ok: false, why: 'stopping' };
    if (store.positions.size + busy.size >= cfg.maxOpenPositions) return { ok: false, why: 'max open positions reached' };
    if (store.stats.pnlLamports <= -solToLamports(cfg.maxDailyLossSol)) {
      return { ok: false, why: `daily loss limit (${cfg.maxDailyLossSol} SOL) reached - no new buys until tomorrow (UTC)` };
    }
    if (store.stats.buys >= cfg.maxTradesPerDay) return { ok: false, why: `daily trade limit (${cfg.maxTradesPerDay}) reached` };
    if (pauseUntil > now()) return { ok: false, why: 'paused' };
    return { ok: true };
  }

  // ---------- discovery ----------
  async function discoveryTick() {
    const found = await market.discover(cfg);
    let added = 0;
    const t = now();
    for (const tok of found) {
      if (watch.has(tok.mint) || blacklist.has(tok.mint) || store.positions.has(tok.mint)) continue;
      if (tok.createdAt && (t - tok.createdAt) / 60000 > cfg.maxAgeMin) continue;
      // skip dust pools (e.g. fresh bonding curves) - they rarely reach the liquidity filter
      if (tok.liquidityUsd > 0 && tok.liquidityUsd < cfg.minLiquidityUsd * 0.3) continue;
      watch.set(tok.mint, { addedAt: t, source: tok.source });
      added++;
    }
    if (watch.size > cfg.maxWatchlist) {
      const oldest = [...watch.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
      for (const [mint] of oldest.slice(0, watch.size - cfg.maxWatchlist)) watch.delete(mint);
    }
    log.info(`Discovery: ${found.length} tokens seen, ${added} new, watching ${watch.size}`);
  }

  // ---------- entry scan ----------
  async function scanTick() {
    const gate = canOpen();
    if (!gate.ok) {
      if (gate.why !== lastGateMsg) log.info(`No new buys: ${gate.why}`);
      lastGateMsg = gate.why;
      return;
    }
    lastGateMsg = '';
    const mints = [...watch.keys()];
    if (!mints.length) return;

    const stats = await market.getStats(mints);
    const t = now();
    const passed = [];
    for (const mint of mints) {
      const p = stats.get(mint);
      const w = watch.get(mint);
      if (!p) {
        if (t - w.addedAt > 15 * 60000) watch.delete(mint); // never got a SOL/USDC pair
        continue;
      }
      if (p.createdAt && (t - p.createdAt) / 60000 > cfg.maxAgeMin) {
        watch.delete(mint);
        continue;
      }
      if (store.positions.has(mint) || busy.has(mint)) continue;
      if ((cooldown.get(mint) ?? 0) > t) continue;
      if (t - (lastEval.get(mint) ?? 0) < cfg.recheckAfterSec * 1000) continue;
      if (checkMarket(p, cfg, t).ok) passed.push(p);
    }
    if (passed.length) log.info(`Scan: ${mints.length} watched, ${passed.length} passed market filters`);
    else log.debug(`Scan: ${mints.length} watched, none passed`);

    passed.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    for (const p of passed.slice(0, cfg.maxCandidatesPerScan)) {
      if (!canOpen().ok) break;
      lastEval.set(p.mint, now());
      await evaluateAndBuy(p);
    }
  }

  function reject(p, reasons, permanent) {
    log.info(`  skip ${p.name} (${shortMint(p.mint)}): ${reasons.join('; ')}`);
    if (permanent) {
      blacklist.set(p.mint, reasons.join('; '));
      watch.delete(p.mint);
    }
  }

  async function evaluateAndBuy(p) {
    const age = p.createdAt ? ((now() - p.createdAt) / 60000).toFixed(1) : '?';
    log.info(
      `Candidate ${p.name} ${shortMint(p.mint)} [${p.dex}] liq $${Math.round(p.liquidityUsd)} ` +
        `mcap $${Math.round(p.mcapUsd)} m5 ${fmtPct(p.m5Change)} buys/sells ${p.m5Buys}/${p.m5Sells} age ${age}m`,
    );

    // 1) on-chain mint settings
    try {
      const r = await deps.checkMint(p.mint);
      if (!r.ok) return reject(p, r.reasons, true);
    } catch (e) {
      return log.warn(`  mint check failed for ${p.name}: ${e.message}`);
    }

    // 2) Jupiter Shield
    if (cfg.useJupShield) {
      try {
        const s = evaluateShield(await jup.shield(p.mint));
        if (!s.ok) return reject(p, s.reasons.map((x) => `shield: ${x}`), true);
      } catch (e) {
        log.debug(`  shield unavailable: ${e.message}`);
      }
    }

    // 3) RugCheck
    if (cfg.useRugcheck) {
      try {
        const r = await deps.checkRug(p.mint);
        if (!r.ok) return reject(p, r.reasons.map((x) => `rugcheck: ${x}`), true);
      } catch (e) {
        if (cfg.rugcheckRequired) return reject(p, [`rugcheck unavailable (${e.message})`], false);
        log.debug(`  rugcheck unavailable: ${e.message}`);
      }
    }

    // 4) Round trip through Jupiter: can we actually sell, and how much do we lose doing it?
    let loss;
    try {
      const qb = await jup.order({ inputMint: SOL_MINT, outputMint: p.mint, amount: tradeLamports });
      const qs = await jup.order({ inputMint: p.mint, outputMint: SOL_MINT, amount: qb.outAmount });
      loss = roundtripLossPct(tradeLamports, Number(qs.outAmount));
    } catch (e) {
      return reject(p, [`no Jupiter route (${e.message})`], false);
    }
    if (loss > cfg.maxRoundtripLossPct) return reject(p, [`round-trip loss ${loss.toFixed(2)}% > ${cfg.maxRoundtripLossPct}%`], false);

    await openPosition(p, loss);
  }

  async function openPosition(p, loss) {
    if (!canOpen().ok) return;
    busy.add(p.mint);
    try {
      if (cfg.mode === 'live') {
        const bal = await deps.getSolBalance();
        if (bal < tradeLamports + reserveLamports) {
          log.warn(`Not enough SOL: have ${fmtSol(lamportsToSol(bal))}, need ${fmtSol(lamportsToSol(tradeLamports + reserveLamports))}. Pausing 5 min.`);
          pauseUntil = now() + 5 * 60000;
          return;
        }
      } else if (store.state.paperBalanceLamports < tradeLamports + reserveLamports) {
        log.warn('Paper balance too low for another trade. Pausing 5 min.');
        pauseUntil = now() + 5 * 60000;
        return;
      }

      const r = await deps.trader.buy(p.mint, tradeLamports);
      const pos = {
        mint: p.mint,
        symbol: p.name,
        dex: p.dex,
        url: p.url,
        openedAt: now(),
        tokenAmount: r.tokenAmount,
        costLamports: r.spentLamports + feeEst,
        peakPnlPct: null,
        lastPnlPct: null,
        quoteFails: 0,
        sellFails: 0,
        buySig: r.signature,
        entry: { liquidityUsd: p.liquidityUsd, mcapUsd: p.mcapUsd, m5Change: p.m5Change, roundtripLossPct: loss },
      };
      store.openPosition(pos);
      cooldown.set(p.mint, now() + cfg.cooldownMin * 60000);
      log.trade(
        `BUY ${p.name} ${shortMint(p.mint)} for ${fmtSol(lamportsToSol(r.spentLamports))} ` +
          `(round-trip ${loss.toFixed(2)}%) ${cfg.mode === 'live' ? `tx ${r.signature}` : '[PAPER]'}${p.url ? ` ${p.url}` : ''}`,
      );
    } catch (e) {
      log.error(`Buy ${p.name} failed: ${e.message}`);
      cooldown.set(p.mint, now() + 5 * 60000);
    } finally {
      busy.delete(p.mint);
    }
  }

  // ---------- position monitor ----------
  async function monitorTick() {
    for (const pos of [...store.positions.values()]) {
      if (busy.has(pos.mint)) continue;
      await checkPosition(pos);
    }
    if (store.positions.size) store.savePositions();
  }

  async function checkPosition(pos) {
    let value;
    try {
      value = (await trader.quoteSell(pos)) - feeEst;
      pos.quoteFails = 0;
    } catch (e) {
      pos.quoteFails = (pos.quoteFails ?? 0) + 1;
      log.warn(`${pos.symbol}: sell quote failed (${pos.quoteFails}/${cfg.maxQuoteFails}): ${e.message}`);
      if (pos.quoteFails >= cfg.maxQuoteFails) await closePos(pos, 'NO_ROUTE');
      return;
    }

    const d = exitDecision(pos, value, now(), cfg);
    pos.peakPnlPct = d.peakPnlPct;
    pos.lastPnlPct = d.pnlPct;
    if (d.action === 'sell') return closePos(pos, d.reason);

    if (now() - (pos.lastLogAt ?? 0) >= 5000) {
      pos.lastLogAt = now();
      const held = Math.round((now() - pos.openedAt) / 1000);
      log.info(`  holding ${pos.symbol}: ${fmtPct(d.pnlPct)} (peak ${fmtPct(d.peakPnlPct)}) ${held}s`);
    }
  }

  async function closePos(pos, reason) {
    busy.add(pos.mint);
    try {
      const r = await trader.sell(pos);
      if (r.nothingToSell) log.warn(`${pos.symbol}: no tokens left in wallet (sold manually?) - closing record`);
      const out = r.nothingToSell ? 0 : Math.max(0, r.outLamports - feeEst);
      const { pnl, pnlPct } = store.closePosition(pos, { outLamports: out, reason, sellSig: r.signature });
      log.trade(
        `SELL ${pos.symbol} ${shortMint(pos.mint)} ${reason}: ${pnl >= 0 ? '+' : ''}${fmtSol(lamportsToSol(pnl))} (${fmtPct(pnlPct)}) ` +
          `held ${Math.round((now() - pos.openedAt) / 1000)}s ${cfg.mode === 'live' ? `tx ${r.signature}` : '[PAPER]'}`,
      );
    } catch (e) {
      pos.sellFails = (pos.sellFails ?? 0) + 1;
      log.error(`SELL ${pos.symbol} (${reason}) failed #${pos.sellFails}: ${e.message} - will retry`);
      if (cfg.mode === 'paper' && reason === 'NO_ROUTE') {
        const { pnl } = store.closePosition(pos, { outLamports: 0, reason: 'NO_ROUTE', sellSig: null });
        log.trade(`SELL ${pos.symbol} NO_ROUTE: token unsellable, counted as total loss ${fmtSol(lamportsToSol(pnl))} [PAPER]`);
      } else {
        store.savePositions();
      }
    } finally {
      busy.delete(pos.mint);
    }
  }

  // ---------- status ----------
  async function heartbeat() {
    const s = store.stats;
    let bal = '';
    try {
      if (cfg.mode === 'live') bal = ` | wallet ${fmtSol(lamportsToSol(await deps.getSolBalance()))}`;
      else bal = ` | paper balance ${fmtSol(lamportsToSol(store.state.paperBalanceLamports))}`;
    } catch {
      /* ignore */
    }
    log.info(
      `STATUS open ${store.positions.size}/${cfg.maxOpenPositions} | today: ${s.buys} buys, ${s.wins}W/${s.losses}L, ` +
        `PnL ${s.pnlLamports >= 0 ? '+' : ''}${fmtSol(lamportsToSol(s.pnlLamports))}${bal} | watching ${watch.size}`,
    );
  }

  async function loop(name, fn, intervalMs) {
    while (!stopping) {
      const t0 = Date.now();
      try {
        await fn();
      } catch (e) {
        log.error(`${name}: ${e.message}`);
      }
      await sleep(Math.max(200, intervalMs - (Date.now() - t0)));
    }
  }

  async function run() {
    await Promise.all([
      loop('monitor', monitorTick, cfg.priceCheckMs),
      loop('discovery', discoveryTick, cfg.discoveryIntervalSec * 1000),
      (async () => {
        await sleep(3000); // let discovery fill the watchlist first
        await loop('scan', scanTick, cfg.scanIntervalSec * 1000);
      })(),
      loop('status', heartbeat, 60000),
    ]);
  }

  function stop() {
    stopping = true;
  }

  return { run, stop, discoveryTick, scanTick, monitorTick, heartbeat, canOpen, watch, blacklist, closePos };
}
