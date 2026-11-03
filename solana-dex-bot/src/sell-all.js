import { setup } from './setup.js';

/** Emergency exit: sells every open position recorded by the bot. */
async function main() {
  const { cfg, log, store, bot } = setup();
  const positions = [...store.positions.values()];
  if (!positions.length) {
    log.info(`No open positions (${cfg.mode} mode).`);
    return;
  }
  log.warn(`Selling ${positions.length} position(s) in ${cfg.mode.toUpperCase()} mode...`);
  for (const pos of positions) await bot.closePos(pos, 'MANUAL');
  log.info(`Done. Still open: ${store.positions.size}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
