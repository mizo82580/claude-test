import { setup } from './setup.js';
import { lamportsToSol } from './config.js';

/** Checks that PRIVATE_KEY and RPC_URL work: prints the address and SOL balance. */
async function main() {
  const { log, keypair, getSolBalance } = setup();
  if (!keypair) {
    log.error('PRIVATE_KEY is not set in .env');
    process.exit(1);
  }
  log.info(`Address: ${keypair.publicKey.toBase58()}`);
  log.info(`Balance: ${lamportsToSol(await getSolBalance()).toFixed(4)} SOL`);
  log.info('If the address matches your Phantom bot wallet, you are set.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
