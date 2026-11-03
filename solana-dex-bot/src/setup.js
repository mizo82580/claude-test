import { Connection } from '@solana/web3.js';
import { loadEnvFile, buildConfig } from './config.js';
import { createLogger } from './util.js';
import { createJupiter } from './jupiter.js';
import { createMarket } from './market.js';
import { createStore } from './store.js';
import { createTrader } from './trader.js';
import { createBot } from './bot.js';
import { checkMintOnChain, checkRugcheck } from './safety.js';
import { loadKeypair, getSolBalanceLamports } from './wallet.js';

/** Wires real dependencies together. Shared by index.js, sell-all.js and wallet-info.js. */
export function setup() {
  if (typeof process.loadEnvFile !== 'function') {
    console.error('Node.js 20.12 or newer is required. Download the LTS version from https://nodejs.org');
    process.exit(1);
  }
  const hadEnv = loadEnvFile();
  const cfg = buildConfig();
  const log = createLogger(cfg.logLevel);
  if (!hadEnv) log.warn('No .env file found - using defaults (paper mode). Copy .env.example to .env to configure.');

  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const keypair = cfg.privateKey ? loadKeypair(cfg.privateKey) : null;
  const jup = createJupiter(cfg, log);
  const market = createMarket(log);
  const store = createStore(cfg);
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
