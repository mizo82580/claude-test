import { MAJOR_MINTS } from './config.js';

/**
 * Market filter: is this young token in its first pump with real liquidity?
 * Pure function so it can be unit tested.
 */
export function checkMarket(p, cfg, now = Date.now()) {
  const reasons = [];
  const ageMin = p.createdAt ? (now - p.createdAt) / 60000 : NaN;

  if (!p.mint || MAJOR_MINTS.has(p.mint)) reasons.push('not a meme token');
  if (!Number.isFinite(ageMin)) reasons.push('unknown age');
  else {
    if (ageMin < cfg.minAgeMin) reasons.push(`too new (${ageMin.toFixed(1)}m)`);
    if (ageMin > cfg.maxAgeMin) reasons.push(`too old (${ageMin.toFixed(0)}m)`);
  }
  if (p.liquidityUsd < cfg.minLiquidityUsd) reasons.push(`liquidity $${Math.round(p.liquidityUsd)}`);
  if (cfg.maxLiquidityUsd > 0 && p.liquidityUsd > cfg.maxLiquidityUsd) reasons.push('liquidity above max');
  if (cfg.minMcapUsd > 0 && p.mcapUsd < cfg.minMcapUsd) reasons.push('mcap below min');
  if (cfg.maxMcapUsd > 0 && p.mcapUsd > cfg.maxMcapUsd) reasons.push(`mcap $${Math.round(p.mcapUsd)}`);
  if (p.m5Change < cfg.minM5ChangePct) reasons.push(`m5 ${p.m5Change}% < ${cfg.minM5ChangePct}%`);
  if (p.m5Change > cfg.maxM5ChangePct) reasons.push(`m5 ${p.m5Change}% already pumped`);
  if (p.m5Buys < cfg.minM5Buys) reasons.push(`m5 buys ${p.m5Buys}`);
  const ratio = p.m5Buys / Math.max(1, p.m5Sells);
  if (ratio < cfg.minBuySellRatio) reasons.push(`buy/sell ${ratio.toFixed(2)}`);
  if (p.m5VolumeUsd < cfg.minM5VolumeUsd) reasons.push(`m5 vol $${Math.round(p.m5VolumeUsd)}`);
  if (cfg.allowedDexes.length && !cfg.allowedDexes.includes(p.dex)) reasons.push(`dex ${p.dex} not allowed`);

  return { ok: reasons.length === 0, reasons, ageMin };
}

/** Ranks candidates: more buy pressure and volume first. */
export function scoreCandidate(p) {
  const ratio = p.m5Buys / Math.max(1, p.m5Sells);
  return ratio * Math.log10(1 + p.m5VolumeUsd) * Math.log10(1 + p.m5Buys);
}

/**
 * Exit rules. `valueLamports` = SOL we would get now by selling everything (net of fee estimate).
 * Returns { action: 'hold' | 'sell', reason, pnlPct, peakPnlPct }.
 */
export function exitDecision(pos, valueLamports, now, cfg) {
  const pnlPct = ((valueLamports - pos.costLamports) / pos.costLamports) * 100;
  const peakPnlPct = Math.max(pos.peakPnlPct ?? -Infinity, pnlPct);
  const base = { pnlPct, peakPnlPct };

  if (pnlPct >= cfg.takeProfitPct) return { ...base, action: 'sell', reason: 'TAKE_PROFIT' };
  if (pnlPct <= -cfg.stopLossPct) return { ...base, action: 'sell', reason: 'STOP_LOSS' };
  if (cfg.trailActivatePct > 0 && peakPnlPct >= cfg.trailActivatePct && pnlPct <= peakPnlPct - cfg.trailDistancePct) {
    return { ...base, action: 'sell', reason: 'TRAILING_STOP' };
  }
  if (cfg.maxHoldSec > 0 && (now - pos.openedAt) / 1000 >= cfg.maxHoldSec) {
    return { ...base, action: 'sell', reason: 'TIMEOUT' };
  }
  return { ...base, action: 'hold', reason: null };
}

/** Round-trip check: buy then immediately sell. High loss = thin liquidity, tax or honeypot. */
export function roundtripLossPct(spentLamports, backLamports) {
  return ((spentLamports - backLamports) / spentLamports) * 100;
}
