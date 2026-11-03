import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfig, SOL_MINT } from '../src/config.js';
import { createBot } from '../src/bot.js';
import { createStore } from '../src/store.js';
import { createTrader } from '../src/trader.js';

const MINT = 'Meme1111111111111111111111111111111111111111';
const quiet = { debug() {}, info() {}, warn() {}, error() {}, trade() {} };

/** Offline harness: fake market + fake Jupiter whose sell price we control. */
function harness(envPatch = {}, { mintOk = true, sellRoute = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdata-'));
  const cfg = buildConfig({ MIN_AGE_MIN: '0', ...envPatch });
  let clock = Date.now();
  const now = () => clock;
  const state = { priceMultiplier: 1, orders: [], trades: [], sellRoute };
  const log = { ...quiet, trade: (m) => state.trades.push(m) };

  const pair = () => ({
    mint: MINT,
    name: 'MEME',
    quoteMint: SOL_MINT,
    dex: 'pumpswap',
    createdAt: clock - 10 * 60000,
    liquidityUsd: 40000,
    mcapUsd: 300000,
    m5Change: 15,
    m5Buys: 90,
    m5Sells: 30,
    m5VolumeUsd: 25000,
  });

  const market = {
    discover: async () => [{ mint: MINT, createdAt: clock - 10 * 60000, liquidityUsd: 40000, source: 'test' }],
    getStats: async (mints) => new Map(mints.map((m) => [m, pair()])),
  };

  // 1 SOL = 1,000,000 tokens (raw), 1% fee each way
  const jup = {
    order: async ({ inputMint, outputMint, amount }) => {
      state.orders.push({ inputMint, outputMint, amount: String(amount) });
      if (inputMint === SOL_MINT) return { inAmount: String(amount), outAmount: String(Math.floor((Number(amount) / 1000) * 0.99)) };
      if (!state.sellRoute) throw new Error('Jupiter order: no route');
      return { inAmount: String(amount), outAmount: String(Math.floor(Number(amount) * 1000 * 0.99 * state.priceMultiplier)) };
    },
    shield: async () => [],
  };

  const store = createStore(cfg, dir);
  const trader = createTrader({ cfg, jup, connection: null, keypair: null, log });
  const bot = createBot({
    cfg,
    jup,
    market,
    trader,
    store,
    log,
    now,
    checkMint: async () => (mintOk ? { ok: true, reasons: [] } : { ok: false, reasons: ['mint authority active'] }),
    checkRug: async () => ({ ok: true, reasons: [] }),
    getSolBalance: async () => 10e9,
  });
  return { cfg, bot, store, state, advance: (ms) => (clock += ms), dir };
}

test('paper: buys a qualifying token, then takes profit', async () => {
  const h = harness();
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  assert.equal(h.store.positions.size, 1, 'should have bought');
  assert.match(h.state.trades[0], /BUY MEME/);

  h.advance(3000);
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 1, 'small move: hold');

  h.state.priceMultiplier = 1.15;
  h.advance(3000);
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 0, 'should have sold');
  assert.match(h.state.trades[1], /SELL MEME .*TAKE_PROFIT/);
  assert.equal(h.store.stats.wins, 1);
  const csv = fs.readFileSync(h.store.tradesFile, 'utf8');
  assert.match(csv, /TAKE_PROFIT/);
});

test('paper: stop loss and paper balance accounting', async () => {
  const h = harness();
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  h.state.priceMultiplier = 0.85;
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 0);
  assert.match(h.state.trades[1], /STOP_LOSS/);
  assert.equal(h.store.stats.losses, 1);
  assert.ok(h.store.state.paperBalanceLamports < 1e9);
});

test('timeout exit', async () => {
  const h = harness();
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  h.advance(121000);
  await h.bot.monitorTick();
  assert.match(h.state.trades[1], /TIMEOUT/);
});

test('unsafe mint is blacklisted, never bought', async () => {
  const h = harness({}, { mintOk: false });
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  assert.equal(h.store.positions.size, 0);
  assert.ok(h.bot.blacklist.has(MINT));
});

test('no sell route (honeypot) is skipped at round-trip check', async () => {
  const h = harness({}, { sellRoute: false });
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  assert.equal(h.store.positions.size, 0);
});

test('round-trip loss above limit is skipped', async () => {
  const h = harness({ MAX_ROUNDTRIP_LOSS_PCT: '1' }); // fake market loses ~2%
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  assert.equal(h.store.positions.size, 0);
});

test('daily loss limit blocks new buys', async () => {
  const h = harness({ MAX_DAILY_LOSS_SOL: '0.01' });
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  h.state.priceMultiplier = 0.5;
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 0);
  assert.equal(h.bot.canOpen().ok, false);
  assert.match(h.bot.canOpen().why, /daily loss/);
});

test('rug after buy: paper counts it as total loss after repeated failed quotes', async () => {
  const h = harness({ MAX_QUOTE_FAILS: '2' });
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  assert.equal(h.store.positions.size, 1);
  h.state.sellRoute = false; // liquidity pulled
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 1, 'one failure: keep trying');
  await h.bot.monitorTick();
  assert.equal(h.store.positions.size, 0);
  assert.match(h.state.trades.at(-1), /NO_ROUTE/);
  assert.equal(h.store.stats.losses, 1);
});

test('positions survive a restart', async () => {
  const h = harness();
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  const again = createStore(h.cfg, h.dir);
  assert.equal(again.positions.size, 1);
  assert.equal(again.stats.buys, 1);
});

test('snapshot, manual sell and stop for the desktop app', async () => {
  const h = harness();
  await h.bot.discoveryTick();
  await h.bot.scanTick();
  h.state.priceMultiplier = 1.03;
  await h.bot.monitorTick();
  const snap = h.bot.snapshot();
  assert.equal(snap.positions.length, 1);
  assert.equal(snap.mode, 'paper');
  assert.ok(snap.positions[0].pnlPct > 0);
  assert.equal(snap.rules.takeProfitPct, 10);
  assert.equal(snap.watchCount, 1);

  assert.equal(await h.bot.sellNow(snap.positions[0].mint), true);
  assert.equal(h.store.positions.size, 0);
  assert.match(h.state.trades.at(-1), /MANUAL/);
  assert.equal(h.store.readTrades().length, 1);
  assert.equal(h.store.readTrades()[0].reason, 'MANUAL');

  const t0 = Date.now();
  const running = h.bot.run();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(h.bot.isRunning(), true);
  h.bot.stop();
  await running;
  assert.equal(h.bot.isRunning(), false);
  assert.ok(Date.now() - t0 < 3000, 'stop should be quick');

  h.store.resetPaper();
  assert.equal(h.store.readTrades().length, 0);
  assert.equal(h.store.state.paperBalanceLamports, 1e9);
});
