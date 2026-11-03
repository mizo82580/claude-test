import { Connection } from '@solana/web3.js';
import { loadEnvFile, buildConfig, DATA_DIR } from './config.js';
import { createLogger } from './util.js';
import { createJupiter } from './jupiter.js';
import { createMarket } from './market.js';
import { createStore } from './store.js';
import { createTrader } from './trader.js';
import { createBot } from './bot.js';
import { checkMintOnChain, checkRugcheck } from './safety.js';
import { loadKeypair, getSolBalanceLamports } from './wallet.js';

/**
 * Builds a full bot runtime from an env-style settings object.
 * Used by the command line (index.js) and the desktop app (app/main.js).
 */
export function createRuntime({ env = process.env, dataDir = DATA_DIR, logSink = null } = {}) {
  const cfg = buildConfig(env);
  const log = createLogger(cfg.logLevel, logSink);
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const keypair = cfg.privateKey ? loadKeypair(cfg.privateKey) : null;
  const jup = createJupiter(cfg, log);
  const market = createMarket(log);
  const store = createStore(cfg, dataDir);
  const trader = createTrader({ cfg, jup, connection, keypair, log });
  const getSolBalance = () => getSolBalanceLamports(connection, keypair.publicKey);

  const bot = createBot({
    cfg,
    jup,
    market,
    trader,
    store,
    log,
    checkMint: (mint) => checkMintOnChain(connection, mint, cfg),
    checkRug: (mint) => checkRugcheck(mint),
    getSolBalance,
  });

  return { cfg, log, connection, keypair, jup, market, store, trader, bot, getSolBalance };
}

/** Command-line setup: reads .env next to package.json. */
export function setup() {
  if (typeof process.loadEnvFile !== 'function') {
    console.error('Node.js 20.12 or newer is required. Download the LTS version from https://nodejs.org');
    process.exit(1);
  }
  const hadEnv = loadEnvFile();
  const rt = createRuntime({ env: process.env });
  if (!hadEnv) rt.log.warn('No .env file found - using defaults (paper mode). Copy .env.example to .env to configure.');
  return rt;
}
