import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../src/config.js';
import { checkMarket, exitDecision, roundtripLossPct, scoreCandidate } from '../src/strategy.js';
import { evaluateShield } from '../src/safety.js';
import { loadKeypair, signBase64Tx } from '../src/wallet.js';
import { Keypair, VersionedTransaction, TransactionMessage, SystemProgram, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const cfg = buildConfig({});
const NOW = 1_800_000_000_000;

const goodPool = () => ({
  mint: 'Meme1111111111111111111111111111111111111111',
  quoteMint: 'So11111111111111111111111111111111111111112',
  name: 'MEME',
  dex: 'pumpswap',
  createdAt: NOW - 10 * 60000,
  liquidityUsd: 30000,
  mcapUsd: 200000,
  m5Change: 12,
  m5Buys: 80,
  m5Sells: 40,
  m5VolumeUsd: 20000,
});

test('defaults are the suggested values', () => {
  assert.equal(cfg.mode, 'paper');
  assert.equal(cfg.tradeSizeSol, 0.1);
  assert.equal(cfg.takeProfitPct, 10);
  assert.equal(cfg.stopLossPct, 8);
  assert.equal(cfg.minLiquidityUsd, 15000);
});

test('live mode requires a private key', () => {
  assert.throws(() => buildConfig({ MODE: 'live' }), /PRIVATE_KEY/);
});

test('market filter accepts a healthy first pump', () => {
  const r = checkMarket(goodPool(), cfg, NOW);
  assert.equal(r.ok, true, r.reasons.join(';'));
});

test('market filter rejects each bad condition', () => {
  const cases = [
    [{ liquidityUsd: 5000 }, /liquidity/],
    [{ createdAt: NOW - 30000 }, /too new/],
    [{ createdAt: NOW - 3 * 3600000 }, /too old/],
    [{ m5Change: 1 }, /m5/],
    [{ m5Change: 90 }, /already pumped/],
    [{ m5Buys: 10 }, /buys/],
    [{ m5Sells: 79 }, /buy\/sell/],
    [{ m5VolumeUsd: 100 }, /vol/],
    [{ mcapUsd: 5_000_000 }, /mcap/],
  ];
  for (const [patch, re] of cases) {
    const r = checkMarket({ ...goodPool(), ...patch }, cfg, NOW);
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.match(r.reasons.join(';'), re);
  }
});

test('dex allow-list', () => {
  const c = { ...cfg, allowedDexes: ['raydium'] };
  assert.equal(checkMarket(goodPool(), c, NOW).ok, false);
  assert.equal(checkMarket({ ...goodPool(), dex: 'raydium' }, c, NOW).ok, true);
});

test('score prefers stronger buy pressure', () => {
  assert.ok(scoreCandidate({ ...goodPool(), m5Sells: 10 }) > scoreCandidate(goodPool()));
});

test('exit rules: TP, SL, trailing, timeout, hold', () => {
  const pos = { costLamports: 100_000_000, openedAt: NOW, peakPnlPct: null };
  assert.equal(exitDecision(pos, 111_000_000, NOW + 5000, cfg).reason, 'TAKE_PROFIT');
  assert.equal(exitDecision(pos, 91_000_000, NOW + 5000, cfg).reason, 'STOP_LOSS');
  assert.equal(exitDecision(pos, 103_000_000, NOW + 5000, cfg).action, 'hold');
  assert.equal(exitDecision({ ...pos, peakPnlPct: 8 }, 103_500_000, NOW + 5000, cfg).reason, 'TRAILING_STOP');
  assert.equal(exitDecision({ ...pos, peakPnlPct: 8 }, 105_000_000, NOW + 5000, cfg).action, 'hold');
  assert.equal(exitDecision(pos, 101_000_000, NOW + 121000, cfg).reason, 'TIMEOUT');
  const noTrail = { ...cfg, trailActivatePct: 0 };
  assert.equal(exitDecision({ ...pos, peakPnlPct: 9 }, 101_000_000, NOW + 5000, noTrail).action, 'hold');
});

test('round trip loss', () => {
  assert.equal(roundtripLossPct(100, 97), 3);
});

test('shield blocks dangerous warnings only', () => {
  assert.equal(evaluateShield([{ type: 'NOT_VERIFIED', severity: 'info' }]).ok, true);
  assert.equal(evaluateShield([{ type: 'HAS_FREEZE_AUTHORITY', severity: 'warning' }]).ok, false);
  assert.equal(evaluateShield([{ type: 'SOMETHING', severity: 'critical' }]).ok, false);
  assert.equal(evaluateShield([]).ok, true);
});

test('keypair loads from Phantom base58 and JSON array, signs a tx', () => {
  const kp = Keypair.generate();
  assert.equal(loadKeypair(bs58.encode(kp.secretKey)).publicKey.toBase58(), kp.publicKey.toBase58());
  assert.equal(loadKeypair(JSON.stringify([...kp.secretKey])).publicKey.toBase58(), kp.publicKey.toBase58());
  assert.throws(() => loadKeypair('not-a-key!!'), /format/);

  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: bs58.encode(new Uint8Array(32).fill(1)),
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(Keypair.generate().publicKey), lamports: 1 })],
  }).compileToV0Message();
  const unsigned = Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
  const signed = VersionedTransaction.deserialize(Buffer.from(signBase64Tx(unsigned, kp), 'base64'));
  assert.ok(signed.signatures[0].some((b) => b !== 0));
});
