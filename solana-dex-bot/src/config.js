import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const MAJOR_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);
export const LAMPORTS_PER_SOL = 1_000_000_000;

function str(env, key, def = '') {
  const v = env[key];
  return v === undefined || v === null || String(v).trim() === '' ? def : String(v).trim();
}

function num(env, key, def) {
  const raw = str(env, key, '');
  if (raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Config ${key}="${raw}" is not a number`);
  return n;
}

function bool(env, key, def) {
  const raw = str(env, key, '').toLowerCase();
  if (raw === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Config ${key}="${raw}" must be true or false`);
}

function list(env, key) {
  return str(env, key, '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Loads .env (if present) into process.env without overriding existing variables. */
export function loadEnvFile(file = path.join(ROOT_DIR, '.env')) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export function buildConfig(env = process.env) {
  const mode = str(env, 'MODE', 'paper').toLowerCase();
  if (!['paper', 'live'].includes(mode)) throw new Error('MODE must be "paper" or "live"');

  const cfg = {
    mode,
    privateKey: str(env, 'PRIVATE_KEY'),
    rpcUrl: str(env, 'RPC_URL', 'https://api.mainnet-beta.solana.com'),
    jupApiKey: str(env, 'JUP_API_KEY'),
    jupSwapBase: str(env, 'JUP_SWAP_BASE'),
    jupMinIntervalMs: num(env, 'JUP_MIN_INTERVAL_MS', 1100),
    slippageBps: num(env, 'SLIPPAGE_BPS', 0),

    // Money management
    tradeSizeSol: num(env, 'TRADE_SIZE_SOL', 0.1),
    maxOpenPositions: num(env, 'MAX_OPEN_POSITIONS', 2),
    minSolReserve: num(env, 'MIN_SOL_RESERVE', 0.05),
    maxDailyLossSol: num(env, 'MAX_DAILY_LOSS_SOL', 0.3),
    maxTradesPerDay: num(env, 'MAX_TRADES_PER_DAY', 40),
    feeEstimateSol: num(env, 'FEE_ESTIMATE_SOL', 0.0003),
    paperStartBalanceSol: num(env, 'PAPER_START_BALANCE_SOL', 1),

    // Entry filters
    minLiquidityUsd: num(env, 'MIN_LIQUIDITY_USD', 15000),
    maxLiquidityUsd: num(env, 'MAX_LIQUIDITY_USD', 0),
    minAgeMin: num(env, 'MIN_AGE_MIN', 2),
    maxAgeMin: num(env, 'MAX_AGE_MIN', 60),
    minMcapUsd: num(env, 'MIN_MCAP_USD', 0),
    maxMcapUsd: num(env, 'MAX_MCAP_USD', 1500000),
    minM5ChangePct: num(env, 'MIN_M5_CHANGE_PCT', 3),
    maxM5ChangePct: num(env, 'MAX_M5_CHANGE_PCT', 40),
    minM5Buys: num(env, 'MIN_M5_BUYS', 25),
    minBuySellRatio: num(env, 'MIN_BUY_SELL_RATIO', 1.3),
    minM5VolumeUsd: num(env, 'MIN_M5_VOLUME_USD', 5000),
    allowedDexes: list(env, 'ALLOWED_DEXES'),
    maxRoundtripLossPct: num(env, 'MAX_ROUNDTRIP_LOSS_PCT', 6),

    // Safety
    requireNoMintAuthority: bool(env, 'REQUIRE_NO_MINT_AUTHORITY', true),
    requireNoFreezeAuthority: bool(env, 'REQUIRE_NO_FREEZE_AUTHORITY', true),
    useJupShield: bool(env, 'USE_JUP_SHIELD', true),
    useRugcheck: bool(env, 'USE_RUGCHECK', true),
    rugcheckRequired: bool(env, 'RUGCHECK_REQUIRED', false),

    // Exit
    takeProfitPct: num(env, 'TAKE_PROFIT_PCT', 10),
    stopLossPct: num(env, 'STOP_LOSS_PCT', 8),
    trailActivatePct: num(env, 'TRAIL_ACTIVATE_PCT', 6),
    trailDistancePct: num(env, 'TRAIL_DISTANCE_PCT', 4),
    maxHoldSec: num(env, 'MAX_HOLD_SEC', 120),
    priceCheckMs: num(env, 'PRICE_CHECK_MS', 1500),
    maxQuoteFails: num(env, 'MAX_QUOTE_FAILS', 6),
    closeTokenAccounts: bool(env, 'CLOSE_TOKEN_ACCOUNTS', true),

    // Scanning
    scanIntervalSec: num(env, 'SCAN_INTERVAL_SEC', 5),
    discoveryIntervalSec: num(env, 'DISCOVERY_INTERVAL_SEC', 30),
    geckoNewPoolPages: num(env, 'GECKO_NEW_POOL_PAGES', 2),
    useGeckoTrending: bool(env, 'USE_GECKO_TRENDING', true),
    useDexscreenerProfiles: bool(env, 'USE_DEXSCREENER_PROFILES', true),
    maxWatchlist: num(env, 'MAX_WATCHLIST', 150),
    maxCandidatesPerScan: num(env, 'MAX_CANDIDATES_PER_SCAN', 3),
    recheckAfterSec: num(env, 'RECHECK_AFTER_SEC', 60),
    cooldownMin: num(env, 'COOLDOWN_MIN', 60),

    logLevel: str(env, 'LOG_LEVEL', 'info').toLowerCase(),
  };

  validate(cfg);
  return cfg;
}

function validate(cfg) {
  const errors = [];
  if (cfg.tradeSizeSol <= 0) errors.push('TRADE_SIZE_SOL must be > 0');
  if (cfg.tradeSizeSol > 5) errors.push('TRADE_SIZE_SOL looks too large (> 5 SOL). Edit config.js if you really mean it.');
  if (cfg.maxOpenPositions < 1) errors.push('MAX_OPEN_POSITIONS must be >= 1');
  if (cfg.takeProfitPct <= 0) errors.push('TAKE_PROFIT_PCT must be > 0');
  if (cfg.stopLossPct <= 0 || cfg.stopLossPct >= 100) errors.push('STOP_LOSS_PCT must be between 0 and 100');
  if (cfg.trailActivatePct > 0 && cfg.trailDistancePct <= 0) errors.push('TRAIL_DISTANCE_PCT must be > 0 when trailing is on');
  if (cfg.priceCheckMs < 300) errors.push('PRICE_CHECK_MS must be >= 300');
  if (cfg.scanIntervalSec < 2) errors.push('SCAN_INTERVAL_SEC must be >= 2');
  if (cfg.discoveryIntervalSec < 10) errors.push('DISCOVERY_INTERVAL_SEC must be >= 10');
  if (cfg.mode === 'live' && !cfg.privateKey) errors.push('MODE=live needs PRIVATE_KEY in .env');
  if (errors.length) throw new Error('Config errors:\n - ' + errors.join('\n - '));
}

export function solToLamports(sol) {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function lamportsToSol(lamports) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}
