import { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../src/setup.js';
import { buildConfig, solToLamports, lamportsToSol } from '../src/config.js';
import { loadKeypair } from '../src/wallet.js';
import { GROUPS, defaultEnv } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USER_DIR = app.getPath('userData');
const DATA_DIR = path.join(USER_DIR, 'data');
const SETTINGS_FILE = path.join(USER_DIR, 'settings.json');
const SAFE_URL = /^https:\/\/(dexscreener\.com|solscan\.io|www\.geckoterminal\.com|portal\.jup\.ag|helius\.dev|www\.helius\.dev|jup\.ag)\//;

let win = null;
let runtime = null;
let runPromise = null;
let balanceCache = { at: 0, sol: null, error: null, loading: false };
const logRing = [];
let logQueue = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------------- settings ----------------
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return { env: {}, key: null };
  }
}

function writeSettings(s) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}

function encryptKey(plain) {
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(plain).toString('base64'), secure: true };
  return { enc: Buffer.from(plain, 'utf8').toString('base64'), secure: false };
}

function decryptKey(k) {
  if (!k?.enc) return '';
  const buf = Buffer.from(k.enc, 'base64');
  return k.secure ? safeStorage.decryptString(buf) : buf.toString('utf8');
}

function currentEnv() {
  const s = readSettings();
  return { ...defaultEnv(), ...s.env, PRIVATE_KEY: decryptKey(s.key) };
}

function walletAddress(env = currentEnv()) {
  try {
    return env.PRIVATE_KEY ? loadKeypair(env.PRIVATE_KEY).publicKey.toBase58() : null;
  } catch {
    return null;
  }
}

// ---------------- logs ----------------
function logSink(level, msg, time) {
  const entry = { level, msg, time };
  logRing.push(entry);
  if (logRing.length > 1500) logRing.splice(0, logRing.length - 1500);
  logQueue.push(entry);
}

setInterval(() => {
  if (!logQueue.length || !win || win.isDestroyed()) return;
  win.webContents.send('log', logQueue);
  logQueue = [];
}, 250);

// ---------------- runtime ----------------
function getRuntime() {
  if (!runtime) runtime = createRuntime({ env: currentEnv(), dataDir: DATA_DIR, logSink });
  return runtime;
}

function isRunning() {
  return Boolean(runtime?.bot.isRunning());
}

function refreshBalance(rt) {
  if (rt.cfg.mode !== 'live' || !rt.keypair || balanceCache.loading) return;
  if (Date.now() - balanceCache.at < 15000) return;
  balanceCache.loading = true;
  rt.getSolBalance()
    .then((l) => (balanceCache = { at: Date.now(), sol: lamportsToSol(l), error: null, loading: false }))
    .catch((e) => (balanceCache = { at: Date.now(), sol: balanceCache.sol, error: e.message, loading: false }));
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA_DIR }));

handle('settings:get', () => {
  const s = readSettings();
  const env = currentEnv();
  delete env.PRIVATE_KEY;
  return { groups: GROUPS, values: env, defaults: defaultEnv(), hasKey: Boolean(s.key), keySecure: s.key?.secure ?? true, address: walletAddress() };
});

handle('settings:save', ({ values, privateKey, clearKey }) => {
  if (isRunning()) throw new Error('أوقف البوت الأول قبل ما تغيّر الإعدادات');
  const s = readSettings();
  let key = s.key;
  if (clearKey) key = null;
  if (privateKey && privateKey.trim()) {
    try {
      loadKeypair(privateKey);
    } catch {
      throw new Error('صيغة المفتاح الخاص مش صحيحة. انسخه من Phantom زي ما هو (Show Private Key).');
    }
    key = encryptKey(privateKey.trim());
  }
  const clean = {};
  for (const [k, v] of Object.entries(values ?? {})) if (k !== 'PRIVATE_KEY') clean[k] = String(v ?? '').trim();
  buildConfig({ ...defaultEnv(), ...clean, PRIVATE_KEY: decryptKey(key) }); // validate
  writeSettings({ env: clean, key });
  runtime = null;
  balanceCache = { at: 0, sol: null, error: null, loading: false };
  return { address: walletAddress() };
});

handle('bot:start', async () => {
  if (isRunning()) return true;
  runtime = null; // always start from the latest saved settings
  const rt = getRuntime();
  if (rt.cfg.mode === 'live') {
    const bal = await rt.getSolBalance();
    const need = solToLamports(rt.cfg.tradeSizeSol + rt.cfg.minSolReserve);
    if (bal < need) {
      throw new Error(`رصيد المحفظة ${lamportsToSol(bal).toFixed(4)} SOL أقل من المطلوب ${lamportsToSol(need).toFixed(4)} SOL`);
    }
  }
  rt.log.info(`Bot started in ${rt.cfg.mode.toUpperCase()} mode`);
  runPromise = rt.bot.run().catch((e) => rt.log.error(`Bot crashed: ${e.message}`));
  return true;
});

handle('bot:stop', async () => {
  if (!isRunning()) return true;
  runtime.bot.stop();
  runtime.log.info('Stopping bot...');
  await Promise.race([runPromise, new Promise((r) => setTimeout(r, 20000))]);
  runtime.store.savePositions();
  runtime.log.info('Bot stopped. Open positions are saved.');
  return true;
});

handle('bot:snapshot', () => {
  let rt;
  try {
    rt = getRuntime();
  } catch (e) {
    return { configError: e.message, running: false, positions: [], stats: null };
  }
  refreshBalance(rt);
  return {
    ...rt.bot.snapshot(),
    wallet: rt.keypair?.publicKey.toBase58() ?? null,
    walletBalanceSol: balanceCache.sol,
    balanceError: balanceCache.error,
    jupiter: rt.jup.usingApiKey ? 'api-key' : 'free',
  };
});

handle('bot:sell', async (mint) => getRuntime().bot.sellNow(mint));
handle('bot:sellAll', async () => getRuntime().bot.sellAll());
handle('trades:list', () => getRuntime().store.readTrades());
handle('logs:history', () => logRing.slice(-800));

handle('paper:reset', () => {
  if (isRunning()) throw new Error('أوقف البوت الأول');
  getRuntime().store.resetPaper();
  return true;
});

handle('shell:open', (url) => {
  if (!SAFE_URL.test(String(url))) throw new Error('blocked url');
  return shell.openExternal(url);
});

handle('shell:openData', () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return shell.openPath(DATA_DIR);
});

// ---------------- window ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#07090f',
    title: 'Solana Momentum Bot',
    icon: path.join(HERE, 'renderer', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07090f', symbolColor: '#8b93a7', height: 44 },
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(HERE, 'renderer', 'index.html'));

  // Developer smoke test: BOT_SMOKE_SHOT=out.png electron .  -> screenshot after load, then quit
  if (process.env.BOT_SMOKE_SHOT) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.BOT_SMOKE_SHOT, img.toPNG());
        app.exit(0);
      }, 4000),
    );
  }

  win.on('close', (e) => {
    if (!isRunning() && !(runtime?.store.positions.size > 0)) return;
    const open = runtime?.store.positions.size ?? 0;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['إقفال', 'إلغاء'],
      defaultId: 1,
      cancelId: 1,
      title: 'البوت شغال',
      message: isRunning() ? 'البوت شغال دلوقتي. لو قفلت البرنامج هيوقف.' : 'فيه صفقات مفتوحة.',
      detail: open
        ? `فيه ${open} صفقة مفتوحة مش هتتابَع لحد ما تفتح البرنامج تاني. لو عاوز تبيعها، استخدم "بيع الكل" الأول.`
        : 'تقدر تشغله تاني في أي وقت.',
    });
    if (choice === 1) e.preventDefault();
    else runtime?.bot.stop();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  runtime?.store.savePositions();
  app.quit();
});
