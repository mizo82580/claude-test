import { buildConfig } from '../src/config.js';

/**
 * Settings form definition for the desktop app. `key` is the env name used by
 * src/config.js, `field` is the matching property on the built config (used for defaults).
 */
export const GROUPS = [
  {
    id: 'mode',
    title: 'وضع التشغيل',
    icon: 'power',
    fields: [
      {
        key: 'MODE',
        field: 'mode',
        type: 'select',
        label: 'الوضع',
        options: [
          ['paper', 'محاكاة (Paper): أسعار حقيقية من غير فلوس'],
          ['live', 'حقيقي (Live): تداول بفلوس حقيقية'],
        ],
        help: 'ابدأ بالمحاكاة كام يوم وراجع النتايج قبل الحقيقي.',
      },
    ],
  },
  {
    id: 'connection',
    title: 'المحفظة والاتصال',
    icon: 'link',
    fields: [
      {
        key: 'PRIVATE_KEY',
        type: 'secret',
        label: 'المفتاح الخاص لمحفظة البوت',
        help: 'من Phantom: Settings ← Manage Accounts ← Show Private Key. بيتحفظ مشفّر على جهازك بس. استخدم محفظة مخصوصة للبوت.',
      },
      {
        key: 'RPC_URL',
        field: 'rpcUrl',
        type: 'text',
        label: 'RPC URL',
        help: 'العام بطيء. خد رابط مجاني من helius.dev',
      },
      {
        key: 'JUP_API_KEY',
        field: 'jupApiKey',
        type: 'password',
        label: 'Jupiter API Key',
        help: 'مجاني من portal.jup.ag. من غيره البوت بيستخدم lite-api الأبطأ.',
      },
    ],
  },
  {
    id: 'money',
    title: 'إدارة رأس المال',
    icon: 'wallet',
    fields: [
      { key: 'TRADE_SIZE_SOL', field: 'tradeSizeSol', type: 'number', step: 0.01, min: 0.001, unit: 'SOL', label: 'حجم الصفقة' },
      { key: 'MAX_OPEN_POSITIONS', field: 'maxOpenPositions', type: 'number', step: 1, min: 1, label: 'أقصى صفقات مفتوحة' },
      { key: 'MIN_SOL_RESERVE', field: 'minSolReserve', type: 'number', step: 0.01, min: 0, unit: 'SOL', label: 'رصيد احتياطي للرسوم' },
      { key: 'MAX_DAILY_LOSS_SOL', field: 'maxDailyLossSol', type: 'number', step: 0.05, min: 0, unit: 'SOL', label: 'حد الخسارة اليومي', help: 'لو اتوصل له البوت يبطل شراء لحد بكرة (UTC).' },
      { key: 'MAX_TRADES_PER_DAY', field: 'maxTradesPerDay', type: 'number', step: 1, min: 1, label: 'أقصى صفقات في اليوم' },
      { key: 'FEE_ESTIMATE_SOL', field: 'feeEstimateSol', type: 'number', step: 0.0001, min: 0, unit: 'SOL', label: 'تقدير الرسوم لكل عملية' },
      { key: 'PAPER_START_BALANCE_SOL', field: 'paperStartBalanceSol', type: 'number', step: 0.1, min: 0.1, unit: 'SOL', label: 'رصيد المحاكاة' },
    ],
  },
  {
    id: 'entry',
    title: 'شروط الدخول',
    icon: 'target',
    fields: [
      { key: 'MIN_LIQUIDITY_USD', field: 'minLiquidityUsd', type: 'number', step: 1000, min: 0, unit: '$', label: 'أقل سيولة' },
      { key: 'MAX_LIQUIDITY_USD', field: 'maxLiquidityUsd', type: 'number', step: 1000, min: 0, unit: '$', label: 'أقصى سيولة', help: '0 = من غير حد' },
      { key: 'MIN_AGE_MIN', field: 'minAgeMin', type: 'number', step: 1, min: 0, unit: 'دقيقة', label: 'أقل عمر للعملة' },
      { key: 'MAX_AGE_MIN', field: 'maxAgeMin', type: 'number', step: 5, min: 1, unit: 'دقيقة', label: 'أقصى عمر للعملة' },
      { key: 'MIN_MCAP_USD', field: 'minMcapUsd', type: 'number', step: 10000, min: 0, unit: '$', label: 'أقل Market Cap' },
      { key: 'MAX_MCAP_USD', field: 'maxMcapUsd', type: 'number', step: 50000, min: 0, unit: '$', label: 'أقصى Market Cap', help: '0 = من غير حد' },
      { key: 'MIN_M5_CHANGE_PCT', field: 'minM5ChangePct', type: 'number', step: 1, unit: '%', label: 'أقل صعود آخر 5 دقايق' },
      { key: 'MAX_M5_CHANGE_PCT', field: 'maxM5ChangePct', type: 'number', step: 1, unit: '%', label: 'أقصى صعود آخر 5 دقايق', help: 'لو طلعت أكتر من كده تبقى طارت خلاص.' },
      { key: 'MIN_M5_BUYS', field: 'minM5Buys', type: 'number', step: 1, min: 0, label: 'أقل عدد شراء آخر 5 دقايق' },
      { key: 'MIN_BUY_SELL_RATIO', field: 'minBuySellRatio', type: 'number', step: 0.1, min: 0, label: 'نسبة الشراء للبيع' },
      { key: 'MIN_M5_VOLUME_USD', field: 'minM5VolumeUsd', type: 'number', step: 500, min: 0, unit: '$', label: 'أقل حجم تداول آخر 5 دقايق' },
      { key: 'ALLOWED_DEXES', field: 'allowedDexes', type: 'list', label: 'المنصات المسموحة', help: 'فاضي = الكل. مثال: pumpswap,raydium,meteora' },
      { key: 'MAX_ROUNDTRIP_LOSS_PCT', field: 'maxRoundtripLossPct', type: 'number', step: 0.5, min: 0, unit: '%', label: 'أقصى خسارة في لفة الاختبار', help: 'شراء وبيع وهمي قبل الدخول. لو الخسارة فيه أكبر من كده: سيولة ضعيفة أو honeypot.' },
    ],
  },
  {
    id: 'safety',
    title: 'فحص الأمان',
    icon: 'shield',
    fields: [
      { key: 'REQUIRE_NO_MINT_AUTHORITY', field: 'requireNoMintAuthority', type: 'bool', label: 'رفض لو الـ Mint Authority شغالة', help: 'الـ dev يقدر يطبع عملات جديدة.' },
      { key: 'REQUIRE_NO_FREEZE_AUTHORITY', field: 'requireNoFreezeAuthority', type: 'bool', label: 'رفض لو الـ Freeze Authority شغالة', help: 'الـ dev يقدر يجمّد عملاتك.' },
      { key: 'USE_JUP_SHIELD', field: 'useJupShield', type: 'bool', label: 'فحص Jupiter Shield' },
      { key: 'USE_RUGCHECK', field: 'useRugcheck', type: 'bool', label: 'فحص RugCheck' },
      { key: 'RUGCHECK_REQUIRED', field: 'rugcheckRequired', type: 'bool', label: 'متشتريش لو RugCheck مش متاح' },
    ],
  },
  {
    id: 'exit',
    title: 'شروط الخروج',
    icon: 'exit',
    fields: [
      { key: 'TAKE_PROFIT_PCT', field: 'takeProfitPct', type: 'number', step: 1, min: 0.1, unit: '%', label: 'هدف الربح (Take Profit)', help: 'صافي بعد الرسوم التقديرية.' },
      { key: 'STOP_LOSS_PCT', field: 'stopLossPct', type: 'number', step: 1, min: 0.1, unit: '%', label: 'وقف الخسارة (Stop Loss)' },
      { key: 'TRAIL_ACTIVATE_PCT', field: 'trailActivatePct', type: 'number', step: 1, min: 0, unit: '%', label: 'تفعيل الـ Trailing عند ربح', help: '0 = إيقاف' },
      { key: 'TRAIL_DISTANCE_PCT', field: 'trailDistancePct', type: 'number', step: 0.5, min: 0, unit: '%', label: 'مسافة الـ Trailing من أعلى نقطة' },
      { key: 'MAX_HOLD_SEC', field: 'maxHoldSec', type: 'number', step: 10, min: 0, unit: 'ثانية', label: 'أقصى مدة للصفقة', help: '0 = من غير حد' },
      { key: 'PRICE_CHECK_MS', field: 'priceCheckMs', type: 'number', step: 100, min: 300, unit: 'ms', label: 'سرعة متابعة السعر' },
      { key: 'MAX_QUOTE_FAILS', field: 'maxQuoteFails', type: 'number', step: 1, min: 1, label: 'مرات فشل التسعير قبل البيع الإجباري' },
      { key: 'CLOSE_TOKEN_ACCOUNTS', field: 'closeTokenAccounts', type: 'bool', label: 'استرجاع إيجار حساب التوكن بعد البيع', help: 'بيرجعلك حوالي 0.002 SOL في كل صفقة.' },
    ],
  },
  {
    id: 'advanced',
    title: 'متقدم',
    icon: 'sliders',
    fields: [
      { key: 'SCAN_INTERVAL_SEC', field: 'scanIntervalSec', type: 'number', step: 1, min: 2, unit: 'ثانية', label: 'فحص قائمة المتابعة كل' },
      { key: 'DISCOVERY_INTERVAL_SEC', field: 'discoveryIntervalSec', type: 'number', step: 5, min: 10, unit: 'ثانية', label: 'البحث عن عملات جديدة كل' },
      { key: 'GECKO_NEW_POOL_PAGES', field: 'geckoNewPoolPages', type: 'number', step: 1, min: 0, label: 'صفحات GeckoTerminal الجديدة' },
      { key: 'USE_GECKO_TRENDING', field: 'useGeckoTrending', type: 'bool', label: 'GeckoTerminal Trending' },
      { key: 'USE_DEXSCREENER_PROFILES', field: 'useDexscreenerProfiles', type: 'bool', label: 'DexScreener Profiles / Boosts' },
      { key: 'MAX_WATCHLIST', field: 'maxWatchlist', type: 'number', step: 10, min: 10, label: 'حجم قائمة المتابعة' },
      { key: 'MAX_CANDIDATES_PER_SCAN', field: 'maxCandidatesPerScan', type: 'number', step: 1, min: 1, label: 'مرشحين يتفحصوا في كل دورة' },
      { key: 'RECHECK_AFTER_SEC', field: 'recheckAfterSec', type: 'number', step: 10, min: 0, unit: 'ثانية', label: 'إعادة فحص نفس العملة بعد' },
      { key: 'COOLDOWN_MIN', field: 'cooldownMin', type: 'number', step: 5, min: 0, unit: 'دقيقة', label: 'منع إعادة شراء نفس العملة لمدة' },
      { key: 'JUP_MIN_INTERVAL_MS', field: 'jupMinIntervalMs', type: 'number', step: 50, min: 50, unit: 'ms', label: 'المسافة بين طلبات Jupiter' },
      { key: 'SLIPPAGE_BPS', field: 'slippageBps', type: 'number', step: 10, min: 0, unit: 'bps', label: 'Slippage', help: '0 = تلقائي من Jupiter (الأفضل)' },
      { key: 'JUP_SWAP_BASE', field: 'jupSwapBase', type: 'text', label: 'عنوان Jupiter Swap API', help: 'فاضي = تلقائي' },
      {
        key: 'LOG_LEVEL',
        field: 'logLevel',
        type: 'select',
        label: 'تفاصيل السجل',
        options: [
          ['info', 'عادي'],
          ['debug', 'تفصيلي'],
          ['warn', 'تحذيرات بس'],
        ],
      },
    ],
  },
];

export const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

/** Default value for every setting, as strings (env style). */
export function defaultEnv() {
  const cfg = buildConfig({});
  const env = {};
  for (const f of ALL_FIELDS) {
    if (!f.field) continue;
    const v = cfg[f.field];
    env[f.key] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  return env;
}
