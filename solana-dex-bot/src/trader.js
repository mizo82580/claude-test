import { SOL_MINT } from './config.js';
import { signBase64Tx, getTokenBalance, closeEmptyTokenAccounts } from './wallet.js';
import { sleep } from './util.js';

/**
 * Executes trades. In paper mode it uses real Jupiter quotes (real prices, real
 * price impact) but never sends a transaction.
 */
export function createTrader({ cfg, jup, connection, keypair, log }) {
  const live = cfg.mode === 'live';
  const taker = keypair?.publicKey?.toBase58();

  async function buy(mint, lamports) {
    if (!live) {
      const q = await jup.order({ inputMint: SOL_MINT, outputMint: mint, amount: lamports, priority: 'high' });
      return { tokenAmount: String(q.outAmount), spentLamports: lamports, signature: 'paper' };
    }

    const q = await jup.order({ inputMint: SOL_MINT, outputMint: mint, amount: lamports, taker, priority: 'high' });
    const r = await jup.execute(signBase64Tx(q.transaction, keypair), q.requestId);
    if (!r.ok) throw new Error(`buy failed: ${r.error}`);

    // Use the real on-chain balance (RPC can lag a moment after landing)
    let raw = 0n;
    for (let i = 0; i < 5 && raw === 0n; i++) {
      try {
        raw = (await getTokenBalance(connection, keypair.publicKey, mint)).raw;
      } catch (e) {
        log.debug(`balance read failed: ${e.message}`);
      }
      if (raw === 0n) await sleep(1200);
    }
    if (raw === 0n) raw = BigInt(r.outAmount ?? q.outAmount);
    return {
      tokenAmount: raw.toString(),
      spentLamports: Number(r.inAmount ?? q.inAmount ?? lamports),
      signature: r.signature,
    };
  }

  /** How many lamports we would receive by selling the whole position now. */
  async function quoteSell(pos) {
    const q = await jup.order({ inputMint: pos.mint, outputMint: SOL_MINT, amount: pos.tokenAmount, priority: 'high' });
    return Number(q.outAmount);
  }

  async function sell(pos) {
    if (!live) {
      const out = await quoteSell(pos);
      return { outLamports: out, signature: 'paper' };
    }

    const bal = await getTokenBalance(connection, keypair.publicKey, pos.mint);
    if (bal.raw === 0n) return { outLamports: 0, signature: null, nothingToSell: true };

    const q = await jup.order({
      inputMint: pos.mint,
      outputMint: SOL_MINT,
      amount: bal.raw.toString(),
      taker,
      priority: 'high',
    });
    const r = await jup.execute(signBase64Tx(q.transaction, keypair), q.requestId);
    if (!r.ok) throw new Error(`sell failed: ${r.error}`);

    if (cfg.closeTokenAccounts) reclaimRent(pos.mint); // background, does not delay the bot
    return { outLamports: Number(r.outAmount ?? q.outAmount), signature: r.signature };
  }

  async function reclaimRent(mint) {
    try {
      await sleep(2000);
      const after = await getTokenBalance(connection, keypair.publicKey, mint);
      if (after.raw !== 0n) return;
      const sig = await closeEmptyTokenAccounts(connection, keypair, after.accounts);
      if (sig) log.info(`Closed empty token account, ~0.002 SOL rent returned (${sig.slice(0, 12)}…)`);
    } catch (e) {
      log.debug(`rent reclaim skipped: ${e.message}`);
    }
  }

  return { buy, sell, quoteSell };
}
