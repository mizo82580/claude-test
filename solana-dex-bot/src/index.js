import { setup } from './setup.js';
import { solToLamports, lamportsToSol } from './config.js';
import { sleep, fmtSol } from './util.js';

async function main() {
  const { cfg, log, keypair, jup, store, bot, getSolBalance } = setup();
  const live = cfg.mode === 'live';

  log.info('==================================================');
  log.info(` Solana DEX bot  |  MODE: ${live ? 'LIVE (real money)' : 'PAPER (simulation, no real trades)'}`);
  log.info(` Trade ${cfg.tradeSizeSol} SOL | max ${cfg.maxOpenPositions} open | TP +${cfg.takeProfitPct}% | SL -${cfg.stopLossPct}% | max hold ${cfg.maxHoldSec}s`);
  log.info(` Trailing: ${cfg.trailActivatePct > 0 ? `after +${cfg.trailActivatePct}%, sell on ${cfg.trailDistancePct}% pullback` : 'off'}`);
  log.info(` Filters: liquidity >= $${cfg.minLiquidityUsd}, age ${cfg.minAgeMin}-${cfg.maxAgeMin} min, m5 ${cfg.minM5ChangePct}..${cfg.maxM5ChangePct}%, buys >= ${cfg.minM5Buys}, buy/sell >= ${cfg.minBuySellRatio}`);
  log.info(` Daily loss limit ${cfg.maxDailyLossSol} SOL | Jupiter: ${jup.swapBase}`);
  if (keypair) log.info(` Wallet: ${keypair.publicKey.toBase58()}`);
  log.info('==================================================');

  if (!jup.usingApiKey) log.warn('No JUP_API_KEY: using the free lite-api. Get a free key at https://portal.jup.ag for better limits.');

  if (live) {
    const bal = await getSolBalance();
    const need = solToLamports(cfg.tradeSizeSol + cfg.minSolReserve);
    log.info(`Wallet balance: ${fmtSol(lamportsToSol(bal))}`);
    if (bal < need) {
      log.error(`Not enough SOL. Need at least ${fmtSol(lamportsToSol(need))} (trade size + reserve).`);
      process.exit(1);
    }
    log.warn('LIVE MODE: real trades start in 10 seconds. Press Ctrl+C now to cancel.');
    await sleep(10000);
  } else {
    log.info(`Paper balance: ${fmtSol(lamportsToSol(store.state.paperBalanceLamports))}`);
  }

  if (store.positions.size) log.info(`Resuming ${store.positions.size} open position(s) from last run.`);

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(0);
    stopping = true;
    bot.stop();
    store.savePositions();
    log.warn('Stopping... open positions are saved and will be watched again on next start.');
    if (store.positions.size) log.warn('To sell everything now run:  npm run sell-all');
    setTimeout(() => process.exit(0), 1500);
  });

  await bot.run();
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
