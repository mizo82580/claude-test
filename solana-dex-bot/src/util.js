export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const out = (lvl, tag) => (...args) => {
    if (LEVELS[lvl] < min) return;
    const line = `${ts()} ${tag} ${args.join(' ')}`;
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: out('debug', '[DBG] '),
    info: out('info', '[INFO]'),
    warn: out('warn', '[WARN]'),
    error: out('error', '[ERR] '),
    trade: out('info', '[TRADE]'),
  };
}

export class HttpError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function preview(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return (s ?? '').slice(0, 300);
}

/** fetch + JSON parse + timeout. Throws HttpError on non-2xx. */
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new HttpError(`HTTP ${res.status} ${url.split('?')[0]}: ${preview(data)}`, res.status, data);
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(`Timeout after ${timeoutMs}ms: ${url.split('?')[0]}`, 0, null);
    if (e instanceof TypeError) {
      throw new HttpError(`Network error (${e.cause?.code ?? e.message}): ${url.split('?')[0]}`, 0, null);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spaces out request starts by `minIntervalMs`. High-priority jobs (open positions)
 * always go before low-priority jobs (scanning).
 */
export class RateLimiter {
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
    this.queues = { high: [], low: [] };
    this.nextAt = 0;
    this.running = false;
  }

  schedule(fn, priority = 'low') {
    return new Promise((resolve, reject) => {
      this.queues[priority === 'high' ? 'high' : 'low'].push({ fn, resolve, reject });
      this.#pump();
    });
  }

  /** Delay all following requests (used after HTTP 429). */
  penalize(ms) {
    this.nextAt = Math.max(this.nextAt, Date.now() + ms);
  }

  async #pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queues.high.length || this.queues.low.length) {
        const wait = this.nextAt - Date.now();
        if (wait > 0) await sleep(wait);
        const job = this.queues.high.shift() ?? this.queues.low.shift();
        if (!job) continue;
        this.nextAt = Date.now() + this.minIntervalMs;
        Promise.resolve()
          .then(job.fn)
          .then(job.resolve, job.reject);
      }
    } finally {
      this.running = false;
    }
  }
}

export function isRetryable(e) {
  return e instanceof HttpError && (e.status === 0 || e.status === 429 || e.status >= 500);
}

export function fmtPct(n) {
  if (!Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtSol(n) {
  return `${Number(n).toFixed(4)} SOL`;
}

export function shortMint(mint) {
  return mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : '?';
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
