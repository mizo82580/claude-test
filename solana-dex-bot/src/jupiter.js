import { fetchJson, RateLimiter, isRetryable } from './util.js';

/**
 * Jupiter client.
 *  - With JUP_API_KEY: https://api.jup.ag/swap/v2   (order + execute, header x-api-key)
 *  - Without key:      https://lite-api.jup.ag/ultra/v1 (free, lower limits, being phased out)
 * Both expose GET /order (quote; adds a transaction when `taker` is set) and POST /execute.
 */
export function createJupiter(cfg, log) {
  const host = cfg.jupApiKey ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';
  const swapBase = (cfg.jupSwapBase || (cfg.jupApiKey ? `${host}/swap/v2` : `${host}/ultra/v1`)).replace(/\/$/, '');
  const shieldUrl = `${host}/ultra/v1/shield`;
  const authHeaders = cfg.jupApiKey ? { 'x-api-key': cfg.jupApiKey } : {};
  const limiter = new RateLimiter(cfg.jupMinIntervalMs);

  async function call(url, opts = {}, priority = 'low') {
    for (let attempt = 0; ; attempt++) {
      try {
        return await limiter.schedule(
          () => fetchJson(url, { ...opts, headers: { ...authHeaders, ...(opts.headers || {}) } }),
          priority,
        );
      } catch (e) {
        if (isRetryable(e) && attempt < 2) {
          if (e.status === 429) log.debug(`Jupiter rate limited, backing off`);
          limiter.penalize(1500 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Quote (and unsigned transaction if `taker` given).
   * Returns the raw Jupiter response; important fields: inAmount, outAmount, transaction, requestId.
   */
  async function order({ inputMint, outputMint, amount, taker, priority = 'low' }) {
    const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount) });
    if (taker) params.set('taker', taker);
    if (cfg.slippageBps > 0) params.set('slippageBps', String(cfg.slippageBps));
    const data = await call(`${swapBase}/order?${params}`, { timeoutMs: 10000 }, priority);
    if (!data || typeof data !== 'object') throw new Error('Jupiter order: empty response');
    if (data.error) throw new Error(`Jupiter order: ${data.error}`);
    if (!data.outAmount || String(data.outAmount) === '0') {
      throw new Error(`Jupiter order: no route${data.errorMessage ? ` (${data.errorMessage})` : ''}`);
    }
    if (taker && !data.transaction) {
      throw new Error(`Jupiter order: no transaction returned${data.errorMessage ? ` (${data.errorMessage})` : ''}`);
    }
    return data;
  }

  /** Sends a signed order transaction. Jupiter handles priority fees and landing. */
  async function execute(signedTransaction, requestId) {
    const data = await call(
      `${swapBase}/execute`,
      { method: 'POST', body: { signedTransaction, requestId }, timeoutMs: 60000 },
      'high',
    );
    const status = String(data?.status ?? '').toLowerCase();
    return {
      ok: status === 'success',
      raw: data,
      signature: data?.signature ?? null,
      error: data?.error ?? data?.errorMessage ?? (status ? `status=${data.status} code=${data?.code}` : 'no status'),
      inAmount: data?.inputAmountResult ?? data?.totalInputAmount ?? null,
      outAmount: data?.outputAmountResult ?? data?.totalOutputAmount ?? null,
    };
  }

  /** Token warnings from Jupiter Shield: [{type, message, severity}] */
  async function shield(mint) {
    const data = await call(`${shieldUrl}?mints=${mint}`, { timeoutMs: 8000 }, 'low');
    const w = data?.warnings?.[mint];
    return Array.isArray(w) ? w : [];
  }

  return { order, execute, shield, swapBase, usingApiKey: Boolean(cfg.jupApiKey) };
}
