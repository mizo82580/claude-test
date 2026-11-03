import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, solToLamports, lamportsToSol } from './config.js';
import { todayKey } from './util.js';

const CSV_HEADER = 'time,mint,symbol,reason,cost_sol,out_sol,pnl_sol,pnl_pct,hold_sec,peak_pct,buy_sig,sell_sig\n';

/** Open positions (survive restarts), trade history CSV, daily stats and paper balance. */
export function createStore(cfg, dir = DATA_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const posFile = path.join(dir, `positions-${cfg.mode}.json`);
  const stateFile = path.join(dir, `state-${cfg.mode}.json`);
  const tradesFile = path.join(dir, `trades-${cfg.mode}.csv`);

  const positions = new Map();
  for (const p of readJson(posFile, [])) positions.set(p.mint, p);

  const state = readJson(stateFile, {});
  if (state.paperBalanceLamports === undefined) state.paperBalanceLamports = solToLamports(cfg.paperStartBalanceSol);

  const stats = { day: todayKey(), buys: 0, closed: 0, wins: 0, losses: 0, pnlLamports: 0 };
  restoreTodayStats();

  function restoreTodayStats() {
    for (const p of positions.values()) if (todayKey(new Date(p.openedAt)) === stats.day) stats.buys++;
    if (!fs.existsSync(tradesFile)) return;
    const lines = fs.readFileSync(tradesFile, 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const c = line.split(',');
      if (c.length < 8 || !c[0].startsWith(stats.day)) continue;
      const pnl = solToLamports(Number(c[6]));
      stats.closed++;
      stats.buys++;
      stats.pnlLamports += pnl;
      if (pnl > 0) stats.wins++;
      else stats.losses++;
    }
  }

  function rollDay() {
    const d = todayKey();
    if (d !== stats.day) Object.assign(stats, { day: d, buys: 0, closed: 0, wins: 0, losses: 0, pnlLamports: 0 });
  }

  function savePositions() {
    writeJsonAtomic(posFile, [...positions.values()]);
  }

  function saveState() {
    writeJsonAtomic(stateFile, state);
  }

  return {
    positions,
    stats,
    state,
    tradesFile,
    rollDay,
    savePositions,

    /** All closed trades from the CSV, oldest first. */
    readTrades() {
      if (!fs.existsSync(tradesFile)) return [];
      return fs
        .readFileSync(tradesFile, 'utf8')
        .split('\n')
        .slice(1)
        .filter((l) => l.trim())
        .map((l) => {
          const c = l.split(',');
          return {
            time: c[0],
            mint: c[1],
            symbol: c[2],
            reason: c[3],
            costSol: Number(c[4]),
            outSol: Number(c[5]),
            pnlSol: Number(c[6]),
            pnlPct: Number(c[7]),
            holdSec: Number(c[8]),
            peakPct: c[9] === '' ? null : Number(c[9]),
            buySig: c[10] || null,
            sellSig: c[11] || null,
          };
        });
    },

    /** Paper mode only: wipe history and start again with a fresh balance. */
    resetPaper() {
      if (cfg.mode !== 'paper') throw new Error('reset is only for paper mode');
      positions.clear();
      savePositions();
      state.paperBalanceLamports = solToLamports(cfg.paperStartBalanceSol);
      saveState();
      if (fs.existsSync(tradesFile)) fs.unlinkSync(tradesFile);
      Object.assign(stats, { day: todayKey(), buys: 0, closed: 0, wins: 0, losses: 0, pnlLamports: 0 });
    },

    openPosition(pos) {
      rollDay();
      positions.set(pos.mint, pos);
      stats.buys++;
      if (cfg.mode === 'paper') {
        state.paperBalanceLamports -= pos.costLamports;
        saveState();
      }
      savePositions();
    },

    closePosition(pos, { outLamports, reason, sellSig }) {
      rollDay();
      positions.delete(pos.mint);
      savePositions();
      const pnl = outLamports - pos.costLamports;
      const pnlPct = (pnl / pos.costLamports) * 100;
      stats.closed++;
      stats.pnlLamports += pnl;
      if (pnl > 0) stats.wins++;
      else stats.losses++;
      if (cfg.mode === 'paper') {
        state.paperBalanceLamports += outLamports;
        saveState();
      }
      if (!fs.existsSync(tradesFile)) fs.writeFileSync(tradesFile, CSV_HEADER);
      const row = [
        new Date().toISOString(),
        pos.mint,
        pos.symbol,
        reason,
        lamportsToSol(pos.costLamports).toFixed(6),
        lamportsToSol(outLamports).toFixed(6),
        lamportsToSol(pnl).toFixed(6),
        pnlPct.toFixed(2),
        Math.round((Date.now() - pos.openedAt) / 1000),
        Number.isFinite(pos.peakPnlPct) ? pos.peakPnlPct.toFixed(2) : '',
        pos.buySig ?? '',
        sellSig ?? '',
      ].join(',');
      fs.appendFileSync(tradesFile, row + '\n');
      return { pnl, pnlPct };
    },
  };
}

function readJson(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
