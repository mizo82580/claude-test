/* global window, document */
const api = window.botApi;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  snap: null,
  trades: [],
  tradesKey: '',
  settings: null,
  logs: [],
  logFilter: 'all',
  logSearch: '',
  errorsUnseen: 0,
  page: 'dashboard',
  equityRange: 'today',
  histFilter: 'all',
  busy: false,
};

// ---------------- helpers ----------------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const signed = (n, d = 4) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(d)}` : '—');
const pct = (n, d = 2) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(d)}%` : '—');
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
const bdi = (t, c = 'mono') => `<bdi class="${c}">${esc(t)}</bdi>`;
const icon = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dur = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

const REASONS = {
  TAKE_PROFIT: ['هدف الربح', 'r-tp'],
  STOP_LOSS: ['وقف الخسارة', 'r-sl'],
  TRAILING_STOP: ['Trailing', 'r-trail'],
  TIMEOUT: ['انتهاء الوقت', 'r-timeout'],
  MANUAL: ['يدوي', 'r-manual'],
  NO_ROUTE: ['مفيش سيولة', 'r-noroute'],
};

function toast(title, body = '', kind = 'info', ms = 5000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(body)}</span>`;
  $('#toasts').prepend(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function confirmModal({ title, body, ok = 'تأكيد', danger = false }) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalOk').textContent = ok;
    $('#modalOk').className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    $('#modalIcon').className = `modal-icon${danger ? ' danger' : ''}`;
    $('#modal').hidden = false;
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modalOk').onclick = $('#modalCancel').onclick = null;
      resolve(v);
    };
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

async function run(fn, errTitle = 'حصل خطأ') {
  try {
    return await fn();
  } catch (e) {
    toast(errTitle, e.message, 'bad', 7000);
    return undefined;
  }
}

// ---------------- navigation ----------------
function go(page) {
  state.page = page;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'logs') {
    state.errorsUnseen = 0;
    renderErrBadge();
    renderLogs(true);
  }
  if (page === 'history') renderHistory();
  if (page === 'settings') loadSettings();
  if (page === 'dashboard') renderChart();
}

$$('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));

// ---------------- top bar ----------------
$('#startStopBtn').addEventListener('click', async () => {
  if (state.busy || !state.snap) return;
  const s = state.snap;
  if (s.running) {
    state.busy = true;
    renderTop();
    await run(() => api.stop(), 'مقدرتش أوقف البوت');
    state.busy = false;
    return refresh();
  }
  if (s.configError) return go('settings');
  if (s.mode === 'live') {
    const ok = await confirmModal({
      title: 'تشغيل بفلوس حقيقية',
      body: `البوت هيشتري ويبيع بفلوس حقيقية من المحفظة <code class="mono">${esc(short(s.wallet))}</code>.<br>حجم الصفقة <b>${s.rules.tradeSizeSol} SOL</b>، وحد الخسارة اليومي <b>${s.rules.maxDailyLossSol} SOL</b>.<br>متأكد إنك جربت المحاكاة الأول؟`,
      ok: 'أيوه، شغّل',
      danger: true,
    });
    if (!ok) return;
  }
  state.busy = true;
  renderTop();
  const r = await run(() => api.start(), 'البوت مشتغلش');
  state.busy = false;
  if (r) toast('البوت اشتغل', s.mode === 'live' ? 'وضع حقيقي' : 'وضع المحاكاة', 'good', 3000);
  refresh();
});

$('#sellAllBtn').addEventListener('click', async () => {
  const n = state.snap?.positions?.length ?? 0;
  if (!n) return toast('مفيش صفقات مفتوحة', '', 'info', 2500);
  const ok = await confirmModal({
    title: 'بيع كل الصفقات',
    body: `هيتم بيع <b>${n}</b> صفقة مفتوحة فوراً بسعر السوق الحالي.`,
    ok: 'بيع الكل',
    danger: true,
  });
  if (!ok) return;
  const r = await run(() => api.sellAll(), 'البيع فشل');
  if (r) toast('تم', `اتباع ${r.sold}، ولسه مفتوح ${r.remaining}`, r.remaining ? 'bad' : 'good');
  refresh();
});

$('#copyAddr').addEventListener('click', () => {
  if (state.snap?.wallet) navigator.clipboard.writeText(state.snap.wallet).then(() => toast('اتنسخ العنوان', '', 'good', 1800));
});

function renderTop() {
  const s = state.snap;
  if (!s) return;
  const live = s.mode === 'live';
  const pill = $('#modePill');
  pill.textContent = live ? 'LIVE' : 'PAPER';
  pill.className = `pill ${live ? 'pill-live' : 'pill-paper'}`;

  const chip = $('#statusChip');
  chip.className = `status-chip${s.running ? ' on' : ''}${s.stopping || state.busy ? ' busy' : ''}`;
  $('b', chip).textContent = state.busy ? 'لحظة...' : s.stopping ? 'بيقف...' : s.running ? 'شغال' : 'متوقف';

  const btn = $('#startStopBtn');
  btn.disabled = state.busy || s.stopping;
  btn.classList.toggle('btn-stop', s.running);
  btn.innerHTML = s.running ? `${icon('stop')}<span>إيقاف البوت</span>` : `${icon('play')}<span>تشغيل البوت</span>`;
  $('#sellAllBtn').disabled = !s.positions?.length;

  $('#walletAddr').textContent = s.wallet ? short(s.wallet) : 'غير مضافة';
  $('#walletAddr').classList.toggle('none', !s.wallet);
  $('#walletAddr').title = s.wallet ?? '';
  $('#copyAddr').hidden = !s.wallet;
  $('#jupState').textContent = s.jupiter === 'api-key' ? 'Jupiter · API key' : 'Jupiter · مجاني';
}

// ---------------- dashboard ----------------
function renderDashboard() {
  const s = state.snap;
  if (!s) return;

  $('#configBanner').hidden = !s.configError;
  if (s.configError) $('#configBanner').innerHTML = `${icon('alert')}<span>الإعدادات فيها مشكلة: ${esc(s.configError)}</span>`;
  const gate = s.running && s.gate && s.gate !== 'max open positions reached' ? s.gate : null;
  $('#gateBanner').hidden = !gate;
  if (gate) $('#gateBanner').innerHTML = `${icon('alert')}<span dir="ltr">${esc(gate)}</span>`;
  if (s.configError) return;

  const live = s.mode === 'live';
  $('#balLabel').textContent = live ? 'رصيد المحفظة' : 'رصيد المحاكاة';
  const bal = live ? s.walletBalanceSol : s.paperBalanceSol;
  $('#kpiBalance').textContent = Number.isFinite(bal) ? fmt(bal) : '—';
  $('#kpiBalanceSub').textContent = live && s.balanceError ? 'تعذّر قراءة الرصيد' : 'SOL';

  const st = s.stats;
  const pnl = $('#kpiPnl');
  pnl.textContent = signed(st.pnlSol);
  pnl.className = `kpi-value mono ${cls(st.pnlSol)}`;
  const closed = st.wins + st.losses;
  $('#kpiWin').textContent = closed ? `${Math.round((st.wins / closed) * 100)}%` : '—';
  $('#kpiWinSub').innerHTML = `${bdi(st.wins)} ربح · ${bdi(st.losses)} خسارة`;
  $('#kpiOpen').textContent = s.positions.length;
  $('#kpiOpenSub').innerHTML = `الحد ${bdi(s.rules.maxOpenPositions)} · النهارده ${bdi(st.buys)} صفقة`;
  $('#kpiWatch').textContent = s.watchCount;
  $('#kpiWatchSub').innerHTML = s.running
    ? s.lastScan.at
      ? `آخر فحص ${bdi(hhmm(s.lastScan.at))} · ${bdi(s.lastScan.passed)} مرشح`
      : 'بيجمع العملات...'
    : 'البوت متوقف';

  renderRules(s.rules);
  renderPositions(s);
}

function renderRules(r) {
  const items = [
    ['حجم الصفقة', `${r.tradeSizeSol} SOL`],
    ['أقصى صفقات', `${r.maxOpenPositions}`],
    ['هدف الربح', `+${r.takeProfitPct}%`],
    ['وقف الخسارة', `-${r.stopLossPct}%`],
    ['Trailing', r.trailActivatePct > 0 ? `+${r.trailActivatePct}% / ${r.trailDistancePct}%` : 'مقفول'],
    ['أقصى مدة', r.maxHoldSec ? `${r.maxHoldSec}s` : '∞'],
  ];
  const html = items.map(([k, v]) => `<div class="rule"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  if ($('#rules').innerHTML !== html) $('#rules').innerHTML = html;
}

function renderPositions(s) {
  const box = $('#positions');
  if (!s.positions.length) {
    box.innerHTML = `<div class="empty">${s.running ? 'مفيش صفقات مفتوحة. البوت بيدوّر على فرص...' : 'مفيش صفقات مفتوحة'}</div>`;
    return;
  }
  const { takeProfitPct: tp, stopLossPct: sl, maxHoldSec } = s.rules;
  const span = tp + sl;
  const posOf = (v) => Math.max(0, Math.min(100, ((v + sl) / span) * 100));
  box.innerHTML = s.positions
    .map((p) => {
      const v = p.pnlPct;
      const color = v == null ? 'var(--muted)' : v >= 0 ? 'var(--good)' : 'var(--bad)';
      const left = v == null ? posOf(0) : posOf(v);
      const peak = p.peakPct == null ? '' : `<i class="peak" style="left:${posOf(p.peakPct)}%" title="أعلى ربح ${pct(p.peakPct)}"></i>`;
      const timeLeft = maxHoldSec ? ` · باقي ${bdi(dur(Math.max(0, maxHoldSec - p.heldSec)))}` : '';
      return `
      <div class="position${p.selling ? ' selling' : ''}">
        <div class="p-name">
          <b>${esc(p.symbol)} <span class="dex">${esc(p.dex || '')}</span>
            ${p.url ? `<button class="icon-btn" data-open="${esc(p.url)}" title="افتح على DexScreener">${icon('external')}</button>` : ''}
          </b>
          <small>${bdi(short(p.mint))} · ${bdi(`${fmt(p.costSol)} SOL`)} · ${bdi(dur(p.heldSec))}${timeLeft}</small>
        </div>
        <div class="p-range">
          <div class="range-bar" style="--zero:${posOf(0)}%">
            <i class="zero-tick"></i>${peak}
            <i class="now" style="left:${left}%;background:${color}"></i>
          </div>
          <div class="range-labels"><span>SL -${sl}%</span><span>0</span><span>TP +${tp}%</span></div>
        </div>
        <div class="p-pnl ${cls(v)}">${pct(v)}<small>${p.selling ? 'بيتباع...' : p.sellFails ? `فشل البيع ${p.sellFails}×` : 'صافي تقديري'}</small></div>
        <button class="btn btn-sm btn-ghost-danger" data-sell="${esc(p.mint)}" ${p.selling ? 'disabled' : ''}>بيع الآن</button>
      </div>`;
    })
    .join('');
}

$('#positions').addEventListener('click', async (e) => {
  const openBtn = e.target.closest('[data-open]');
  if (openBtn) return run(() => api.openUrl(openBtn.dataset.open));
  const sellBtn = e.target.closest('[data-sell]');
  if (!sellBtn) return;
  const p = state.snap.positions.find((x) => x.mint === sellBtn.dataset.sell);
  const ok = await confirmModal({
    title: `بيع ${esc(p?.symbol ?? '')}`,
    body: `بيع الصفقة دي فوراً بسعر السوق؟ الربح الحالي التقديري <b class="${cls(p?.pnlPct)}">${pct(p?.pnlPct)}</b>`,
    ok: 'بيع',
    danger: true,
  });
  if (!ok) return;
  sellBtn.disabled = true;
  await run(() => api.sell(sellBtn.dataset.sell), 'البيع فشل');
  refresh();
});

// ---------------- activity feed (from logs) ----------------
const activity = [];

function toActivity(entry) {
  const m = entry.msg;
  let a = null;
  if (entry.level === 'trade') {
    const buy = m.match(/^BUY (\S+) .*? for ([\d.]+) SOL/);
    const sell = m.match(/^SELL (\S+) .*?(TAKE_PROFIT|STOP_LOSS|TRAILING_STOP|TIMEOUT|MANUAL|NO_ROUTE).*?\(([+-]?[\d.]+)%\)/);
    if (buy) a = { kind: 'buy', ic: 'zap', text: `<b>شراء ${bdi(buy[1], '')}</b> بـ ${bdi(`${buy[2]} SOL`)}` };
    else if (sell) {
      const v = Number(sell[3]);
      a = { kind: v > 0 ? 'win' : 'loss', ic: 'exit', text: `<b>بيع ${bdi(sell[1], '')}</b> · ${REASONS[sell[2]]?.[0] ?? sell[2]} · ${bdi(pct(v), `mono ${cls(v)}`)}` };
    } else a = { kind: 'info', ic: 'zap', text: esc(m) };
  } else if (m.startsWith('Candidate ')) {
    const c = m.match(/^Candidate (\S+)/);
    a = { kind: 'info', ic: 'target', text: `مرشح جديد <b>${bdi(c?.[1] ?? '', '')}</b> بيتفحص...` };
  } else if (m.trim().startsWith('skip ')) {
    const c = m.trim().match(/^skip (\S+) \([^)]*\): (.*)$/);
    a = { kind: 'warn', ic: 'shield', text: `اترفض <b>${bdi(c?.[1] ?? '', '')}</b>: ${bdi(c?.[2] ?? '', '')}` };
  } else if (entry.level === 'error') {
    a = { kind: 'loss', ic: 'alert', text: bdi(m, '') };
  } else if (/^Bot (started|stopped)/.test(m)) {
    a = { kind: 'info', ic: 'power', text: m.startsWith('Bot started') ? 'البوت اشتغل' : 'البوت وقف' };
  }
  if (!a) return;
  activity.unshift({ ...a, time: entry.time });
  if (activity.length > 60) activity.length = 60;
}

function renderActivity() {
  $('#activity').innerHTML = activity.length
    ? activity
        .map(
          (a) =>
            `<li><span class="act-ic act-${a.kind}">${icon(a.ic)}</span><span class="act-text">${a.text}</span><span class="act-time">${hhmm(a.time)}</span></li>`,
        )
        .join('')
    : '<li class="empty">لسه مفيش نشاط</li>';
}

function notifyTrade(entry) {
  const m = entry.msg;
  const buy = m.match(/^BUY (\S+) .*? for ([\d.]+) SOL/);
  if (buy) return toast(`شراء ${buy[1]}`, `${buy[2]} SOL`, 'info');
  const sell = m.match(/^SELL (\S+) .*?(TAKE_PROFIT|STOP_LOSS|TRAILING_STOP|TIMEOUT|MANUAL|NO_ROUTE): ([+-]?[\d.]+) SOL \(([+-]?[\d.]+)%\)/);
  if (sell) {
    const v = Number(sell[4]);
    toast(`بيع ${sell[1]} · ${REASONS[sell[2]]?.[0] ?? sell[2]}`, `${sell[3]} SOL (${pct(v)})`, v > 0 ? 'good' : 'bad', 7000);
  }
}

// ---------------- equity chart ----------------
$$('#equityRange button').forEach((b) =>
  b.addEventListener('click', () => {
    state.equityRange = b.dataset.range;
    $$('#equityRange button').forEach((x) => x.classList.toggle('active', x === b));
    renderChart();
  }),
);

function chartTrades() {
  const now = Date.now();
  const from =
    state.equityRange === 'today'
      ? Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
      : state.equityRange === '7d'
        ? now - 7 * 86400000
        : 0;
  return state.trades.filter((t) => Date.parse(t.time) >= from);
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function renderChart() {
  const svg = $('#equityChart');
  const trades = chartTrades();
  $('#chartEmpty').hidden = trades.length > 0;
  if (!trades.length) {
    svg.innerHTML = '';
    return;
  }
  const W = svg.clientWidth || 700;
  const H = svg.clientHeight || 230;
  const m = { l: 58, r: 14, t: 12, b: 26 };
  let cum = 0;
  const pts = [{ x: 0, y: 0, t: null }].concat(
    trades.map((t, i) => {
      cum += t.pnlSol;
      return { x: i + 1, y: cum, t };
    }),
  );
  const ys = pts.map((p) => p.y);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const yMin = ticks[0];
  const yMax = ticks.at(-1);
  const sx = (x) => m.l + (x / Math.max(1, pts.length - 1)) * (W - m.l - m.r);
  const sy = (y) => m.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = `${path}L${sx(pts.at(-1).x).toFixed(1)},${sy(0).toFixed(1)}L${sx(0).toFixed(1)},${sy(0).toFixed(1)}Z`;
  const decimals = yMax - yMin < 0.05 ? 3 : 2;
  const xLabels = [pts[1], pts[Math.floor(pts.length / 2)], pts.at(-1)].filter((p, i, a) => p && a.indexOf(p) === i);
  const showDots = trades.length <= 60;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9a73ff" stop-opacity=".28"/>
        <stop offset="1" stop-color="#9a73ff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g class="grid">${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('')}</g>
    <line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>
    <g class="axis">
      ${ticks.map((v) => `<text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${v.toFixed(decimals)}</text>`).join('')}
      ${xLabels.map((p) => `<text x="${sx(p.x)}" y="${H - 6}" text-anchor="${p === pts.at(-1) ? 'end' : 'middle'}">${new Date(p.t.time).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</text>`).join('')}
    </g>
    <path d="${area}" fill="url(#eqFill)"/>
    <path class="line" d="${path}"/>
    ${showDots ? pts.slice(1).map((p) => `<circle class="dot" cx="${sx(p.x)}" cy="${sy(p.y)}" r="4" fill="${p.t.pnlSol > 0 ? 'var(--good)' : 'var(--bad)'}"/>`).join('') : ''}
    <line class="cross" id="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    <circle id="crossDot" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect id="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/>
  `;

  const tip = $('#chartTip');
  const hit = $('#hit', svg);
  hit.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const idx = Math.max(1, Math.min(pts.length - 1, Math.round(((x - m.l) / (W - m.l - m.r)) * (pts.length - 1))));
    const p = pts[idx];
    const cx = sx(p.x);
    const cy = sy(p.y);
    $('#cross', svg).setAttribute('x1', cx);
    $('#cross', svg).setAttribute('x2', cx);
    $('#cross', svg).setAttribute('visibility', 'visible');
    $('#crossDot', svg).setAttribute('cx', cx);
    $('#crossDot', svg).setAttribute('cy', cy);
    $('#crossDot', svg).setAttribute('visibility', 'visible');
    const t = p.t;
    const win = t.pnlSol > 0;
    tip.innerHTML = `
      <div class="t-head"><span class="reason ${REASONS[t.reason]?.[1] ?? 'r-timeout'}">${win ? '▲' : '▼'} ${REASONS[t.reason]?.[0] ?? esc(t.reason)}</span> ${esc(t.symbol)}</div>
      <div class="t-row"><span>صفقة رقم</span><b>${idx}</b></div>
      <div class="t-row"><span>الوقت</span><b>${new Date(t.time).toLocaleString('en-GB')}</b></div>
      <div class="t-row"><span>ربح الصفقة</span><b>${signed(t.pnlSol)} SOL (${pct(t.pnlPct)})</b></div>
      <div class="t-row"><span>الإجمالي</span><b>${signed(p.y)} SOL</b></div>`;
    tip.hidden = false;
    const px = (cx / W) * r.width;
    const py = (cy / H) * r.height;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px + 14))}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 12)}px`;
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    $('#cross', svg).setAttribute('visibility', 'hidden');
    $('#crossDot', svg).setAttribute('visibility', 'hidden');
  });
}

window.addEventListener('resize', () => state.page === 'dashboard' && renderChart());

// ---------------- history ----------------
$$('#histFilter button').forEach((b) =>
  b.addEventListener('click', () => {
    state.histFilter = b.dataset.f;
    $$('#histFilter button').forEach((x) => x.classList.toggle('active', x === b));
    renderHistory();
  }),
);

$('#openDataBtn').addEventListener('click', () => run(() => api.openDataFolder()));
$('#resetPaperBtn').addEventListener('click', async () => {
  const ok = await confirmModal({
    title: 'تصفير حساب المحاكاة',
    body: 'هيتمسح سجل صفقات المحاكاة كله ويرجع الرصيد للقيمة اللي في الإعدادات. الوضع الحقيقي مش هيتأثر.',
    ok: 'تصفير',
    danger: true,
  });
  if (!ok) return;
  if (await run(() => api.resetPaper(), 'مقدرتش أصفّر')) {
    toast('اتصفّر حساب المحاكاة', '', 'good', 2500);
    await loadTrades(true);
    refresh();
  }
});

function renderHistory() {
  const all = state.trades;
  const wins = all.filter((t) => t.pnlSol > 0);
  const losses = all.filter((t) => t.pnlSol <= 0);
  const total = all.reduce((a, t) => a + t.pnlSol, 0);
  const grossW = wins.reduce((a, t) => a + t.pnlSol, 0);
  const grossL = Math.abs(losses.reduce((a, t) => a + t.pnlSol, 0));
  const avg = (arr) => (arr.length ? arr.reduce((a, t) => a + t.pnlPct, 0) / arr.length : NaN);
  const stats = [
    ['الصفقات', `${all.length}`, ''],
    ['صافي الربح', `${signed(total)} SOL`, cls(total)],
    ['نسبة النجاح', all.length ? `${Math.round((wins.length / all.length) * 100)}%` : '—', ''],
    ['متوسط الربح', pct(avg(wins)), 'pos'],
    ['متوسط الخسارة', pct(avg(losses)), 'neg'],
    ['Profit Factor', grossL ? (grossW / grossL).toFixed(2) : wins.length ? '∞' : '—', ''],
  ];
  $('#histStats').innerHTML = stats
    .map(([k, v, c]) => `<div class="kpi"><div class="kpi-label">${k}</div><div class="kpi-value mono ${c}" style="font-size:20px">${v}</div></div>`)
    .join('');

  const rows = all
    .filter((t) => (state.histFilter === 'win' ? t.pnlSol > 0 : state.histFilter === 'loss' ? t.pnlSol <= 0 : true))
    .slice()
    .reverse();
  $('#histCount').textContent = `${rows.length} صفقة`;
  $('#histEmpty').hidden = rows.length > 0;
  const tx = (sig, label) =>
    sig && sig !== 'paper' ? `<button class="icon-btn" data-open="https://solscan.io/tx/${esc(sig)}" title="${label}">${icon('external')}</button>` : '';
  $('#histTable tbody').innerHTML = rows
    .map((t) => {
      const [label, c] = REASONS[t.reason] ?? [t.reason, 'r-timeout'];
      return `<tr>
        <td class="mono" dir="ltr" style="text-align:right">${new Date(t.time).toLocaleString('en-GB')}</td>
        <td><b>${esc(t.symbol)}</b> <button class="icon-btn" data-open="https://dexscreener.com/solana/${esc(t.mint)}" title="DexScreener">${icon('external')}</button></td>
        <td><span class="reason ${c}">${esc(label)}</span></td>
        <td class="num">${fmt(t.costSol)}</td>
        <td class="num">${fmt(t.outSol)}</td>
        <td class="num ${cls(t.pnlSol)}">${signed(t.pnlSol)}</td>
        <td class="num ${cls(t.pnlPct)}">${pct(t.pnlPct)}</td>
        <td class="num">${t.peakPct == null ? '—' : pct(t.peakPct)}</td>
        <td class="num">${dur(t.holdSec)}</td>
        <td>${tx(t.buySig, 'معاملة الشراء')}${tx(t.sellSig, 'معاملة البيع')}</td>
      </tr>`;
    })
    .join('');
  $('#resetPaperBtn').hidden = state.snap?.mode !== 'paper';
}

$('#histTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) run(() => api.openUrl(b.dataset.open));
});

async function loadTrades(force = false) {
  const t = await api.trades().catch(() => null);
  if (!t) return;
  const key = `${t.length}:${t.at(-1)?.time ?? ''}`;
  if (!force && key === state.tradesKey) return;
  state.tradesKey = key;
  state.trades = t;
  if (state.page === 'dashboard') renderChart();
  if (state.page === 'history') renderHistory();
}

// ---------------- logs ----------------
$$('#logFilter button').forEach((b) =>
  b.addEventListener('click', () => {
    state.logFilter = b.dataset.l;
    $$('#logFilter button').forEach((x) => x.classList.toggle('active', x === b));
    renderLogs(true);
  }),
);
$('#logSearch').addEventListener('input', (e) => {
  state.logSearch = e.target.value.toLowerCase();
  renderLogs(true);
});
$('#clearLogs').addEventListener('click', () => {
  state.logs = [];
  renderLogs(true);
});

const LV = { info: 'INFO', debug: 'DEBUG', warn: 'WARN', error: 'ERROR', trade: 'TRADE' };
const logMatch = (e) =>
  (state.logFilter === 'all' || e.level === state.logFilter) && (!state.logSearch || e.msg.toLowerCase().includes(state.logSearch));
const logHtml = (e) =>
  `<div class="log-line l-${e.level}"><span class="lt">${hhmm(e.time)}</span><span class="lv">${LV[e.level] ?? e.level}</span>${esc(e.msg)}</div>`;

function renderLogs(full, fresh = []) {
  if (state.page !== 'logs') return;
  const box = $('#logBox');
  if (full) box.innerHTML = state.logs.filter(logMatch).slice(-1000).map(logHtml).join('');
  else if (fresh.length) {
    box.insertAdjacentHTML('beforeend', fresh.filter(logMatch).map(logHtml).join(''));
    while (box.childElementCount > 1200) box.firstElementChild.remove();
  }
  if ($('#autoScroll').checked) box.scrollTop = box.scrollHeight;
}

function renderErrBadge() {
  const b = $('#errBadge');
  b.hidden = !state.errorsUnseen;
  b.textContent = state.errorsUnseen > 99 ? '99+' : state.errorsUnseen;
}

function ingestLogs(batch, live = true) {
  let tradeSeen = false;
  for (const e of batch) {
    state.logs.push(e);
    toActivity(e);
    if (live && e.level === 'trade') {
      notifyTrade(e);
      tradeSeen = true;
    }
    if (live && e.level === 'error' && state.page !== 'logs') state.errorsUnseen++;
  }
  if (state.logs.length > 3000) state.logs.splice(0, state.logs.length - 3000);
  renderLogs(false, batch);
  renderActivity();
  renderErrBadge();
  if (tradeSeen) loadTrades(true);
}

api.onLog((batch) => ingestLogs(batch));

// ---------------- settings ----------------
const GROUP_ICONS = { power: 'power', link: 'link', wallet: 'wallet', target: 'target', shield: 'shield', exit: 'exit', sliders: 'cpu' };

async function loadSettings() {
  const s = await run(() => api.getSettings(), 'مقدرتش أقرا الإعدادات');
  if (!s) return;
  state.settings = s;
  renderSettings();
}

function fieldHtml(f, values) {
  const v = values[f.key] ?? '';
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  if (f.type === 'bool') {
    return `<div class="field"><label class="toggle"><span>${esc(f.label)}</span><input type="checkbox" data-key="${f.key}" ${v === 'true' ? 'checked' : ''}></label>${help}</div>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map(([val, label]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
    return `<div class="field${f.key === 'MODE' ? ' wide' : ''}"><label>${esc(f.label)}</label><div class="input-wrap"><select data-key="${f.key}">${opts}</select></div>${help}
      ${f.key === 'MODE' ? `<div class="banner banner-danger live-warning" id="liveWarn" ${v === 'live' ? '' : 'hidden'}>${icon('alert')}<span>الوضع الحقيقي بيتداول بفلوسك. أغلب العملات الجديدة بتطلع scam، والـ Stop Loss مش بيحميك من سحب السيولة المفاجئ.</span></div>` : ''}</div>`;
  }
  if (f.type === 'secret') {
    const s = state.settings;
    const saved = s.hasKey
      ? `<div class="key-state">${icon('check')}<span>مفتاح محفوظ${s.keySecure ? ' ومشفّر' : ''} · العنوان</span><code>${esc(short(s.address ?? ''))}</code><button class="link-btn" id="clearKey" style="margin-inline-start:auto">مسح المفتاح</button></div>`
      : '';
    return `<div class="field wide"><label>${esc(f.label)}</label>${saved}
      <div class="input-wrap"><input type="password" id="pkInput" autocomplete="off" spellcheck="false" placeholder="${s.hasKey ? 'اكتب مفتاح جديد لو عاوز تغيّره' : 'الصق الـ Private Key هنا'}">
      <button class="icon-btn" type="button" id="pkToggle" title="إظهار">${icon('eye')}</button></div>${help}</div>`;
  }
  const type = f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text';
  const attrs = f.type === 'number' ? `step="${f.step ?? 'any'}" ${f.min != null ? `min="${f.min}"` : ''}` : 'spellcheck="false" autocomplete="off"';
  return `<div class="field${f.key === 'RPC_URL' ? ' wide' : ''}"><label>${esc(f.label)}</label>
    <div class="input-wrap">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}<input type="${type}" data-key="${f.key}" value="${esc(v)}" ${attrs}></div>${help}</div>`;
}

function renderSettings() {
  const s = state.settings;
  const locked = Boolean(state.snap?.running);
  $('#settingsLock').hidden = !locked;
  $('#saveSettings').disabled = locked;
  $('#settingsForm').innerHTML = s.groups
    .map(
      (g) => `<div class="card set-group"><h3><span class="gi">${icon(GROUP_ICONS[g.icon] ?? g.icon)}</span>${esc(g.title)}</h3>
        <div class="fields">${g.fields.map((f) => fieldHtml(f, s.values)).join('')}</div></div>`,
    )
    .join('');

  $('#pkToggle')?.addEventListener('click', () => {
    const i = $('#pkInput');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('#clearKey')?.addEventListener('click', async () => {
    const ok = await confirmModal({ title: 'مسح المفتاح', body: 'هيتمسح المفتاح الخاص من الجهاز. هتحتاج تضيفه تاني للتداول الحقيقي.', ok: 'مسح', danger: true });
    if (!ok) return;
    if (await run(() => api.saveSettings({ values: collectValues(), clearKey: true }), 'مقدرتش أمسح')) {
      toast('اتمسح المفتاح', '', 'good', 2500);
      await loadSettings();
      refresh();
    }
  });
}

$('#settingsForm').addEventListener('input', (e) => {
  const el = e.target.closest('[data-key]');
  if (!el || !state.settings) return;
  const wrap = el.closest('.input-wrap');
  if (wrap) wrap.classList.toggle('changed', readField(el) !== (state.settings.values[el.dataset.key] ?? ''));
  if (el.dataset.key === 'MODE') $('#liveWarn').hidden = el.value !== 'live';
  $('#saveMsg').textContent = 'فيه تغييرات مش محفوظة';
});

const readField = (el) => (el.type === 'checkbox' ? String(el.checked) : el.value.trim());

function collectValues() {
  const out = {};
  $$('#settingsForm [data-key]').forEach((el) => (out[el.dataset.key] = readField(el)));
  return out;
}

$('#saveSettings').addEventListener('click', async () => {
  const values = collectValues();
  const privateKey = $('#pkInput')?.value ?? '';
  if (values.MODE === 'live' && state.settings.values.MODE !== 'live') {
    const ok = await confirmModal({
      title: 'التحويل للوضع الحقيقي',
      body: 'بعد الحفظ، البوت هيتداول بفلوس حقيقية لما تشغله. متأكد؟',
      ok: 'أيوه',
      danger: true,
    });
    if (!ok) return;
  }
  const r = await run(() => api.saveSettings({ values, privateKey }), 'الإعدادات متحفظتش');
  if (!r) return;
  $('#saveMsg').textContent = '';
  toast('اتحفظت الإعدادات', r.address ? `المحفظة ${short(r.address)}` : '', 'good', 3000);
  await loadSettings();
  refresh();
});

$('#resetDefaults').addEventListener('click', () => {
  const d = state.settings.defaults;
  $$('#settingsForm [data-key]').forEach((el) => {
    const k = el.dataset.key;
    if (['RPC_URL', 'JUP_API_KEY', 'MODE'].includes(k)) return; // keep connection + mode
    if (el.type === 'checkbox') el.checked = d[k] === 'true';
    else el.value = d[k] ?? '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  toast('اترجعت القيم المقترحة', 'اضغط حفظ عشان تتطبق', 'info', 3000);
});

// ---------------- polling ----------------
async function refresh() {
  const s = await api.snapshot().catch(() => null);
  if (!s) return;
  const wasRunning = state.snap?.running;
  state.snap = s;
  renderTop();
  renderDashboard();
  if (state.page === 'settings' && state.settings && wasRunning !== s.running) renderSettings();
  if (state.page === 'history') $('#resetPaperBtn').hidden = s.mode !== 'paper';
}

async function init() {
  const info = await api.info().catch(() => null);
  if (info) $('#appVersion').textContent = `v${info.version}`;
  const hist = await api.logHistory().catch(() => []);
  ingestLogs(hist, false);
  await refresh();
  await loadTrades(true);
  renderActivity();
  setInterval(refresh, 1000);
  setInterval(loadTrades, 5000);
}

init();
