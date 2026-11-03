import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

/** Accepts a Phantom-exported base58 private key or a JSON array [1,2,...]. */
export function loadKeypair(secret) {
  const s = String(secret ?? '').trim().replace(/^"|"$/g, '');
  if (!s) throw new Error('PRIVATE_KEY is empty');
  let bytes;
  try {
    bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  } catch {
    throw new Error('PRIVATE_KEY format not recognized (expected base58 string from Phantom or a JSON array)');
  }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`PRIVATE_KEY has ${bytes.length} bytes, expected 64`);
}

export function signBase64Tx(b64, keypair) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
  tx.sign([keypair]);
  return Buffer.from(tx.serialize()).toString('base64');
}

export async function getSolBalanceLamports(connection, owner) {
  return connection.getBalance(owner, 'confirmed');
}

/** Sum of all token accounts we hold for `mint` (raw units). */
export async function getTokenBalance(connection, owner, mint) {
  const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }, 'confirmed');
  let raw = 0n;
  const accounts = [];
  for (const a of res.value) {
    const amount = BigInt(a.account.data?.parsed?.info?.tokenAmount?.amount ?? '0');
    raw += amount;
    accounts.push({ pubkey: a.pubkey, programId: a.account.owner, amount });
  }
  return { raw, accounts };
}

/** Closes empty token accounts to get back the ~0.002 SOL rent each one holds. */
export async function closeEmptyTokenAccounts(connection, keypair, accounts) {
  const empty = accounts.filter((a) => a.amount === 0n);
  if (!empty.length) return null;
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 + empty.length * 10000 }));
  for (const a of empty) {
    tx.add(
      new TransactionInstruction({
        programId: a.programId,
        keys: [
          { pubkey: a.pubkey, isSigner: false, isWritable: true },
          { pubkey: keypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([9]), // SPL Token "CloseAccount"
      }),
    );
  }
  return sendAndConfirmTransaction(connection, tx, [keypair], { commitment: 'confirmed' });
}
