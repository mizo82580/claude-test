import { fetchJson, RateLimiter, isRetryable } from './util.js';
import { MAJOR_MINTS } from './config.js';

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana';
const DEXS = 'https://api.dexscreener.com';

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Discovery (find young token mints) + market data (fresh stats per mint).
 *  - GeckoTerminal: new pools + trending pools (free, ~30 req/min, data cached ~60s)
 *  - DexScreener:   latest token profiles/boosts (60 req/min) and pair stats (300 req/min)
 */
export function createMarket(log) {
  const geckoLimiter = new RateLimiter(2500);
  const dexsLimiter = new RateLimiter(250);

  async function get(limiter, url, isStopped = () => false) {
    for (let attempt = 0; ; attempt++) {
      if (isStopped()) throw new Error('stopped');
      try {
        return await limiter.schedule(() => fetchJson(url, { timeoutMs: 12000 }));
      } catch (e) {
        if (isRetryable(e) && attempt < 2 && !isStopped()) {
          limiter.penalize(3000 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  }

  function geckoPoolToMint(item) {
    const baseId = item?.relationships?.base_token?.data?.id ?? '';
    const quoteId = item?.relationships?.quote_token?.data?.id ?? '';
    const base = baseId.replace(/^solana_/, '');
    const quote = quoteId.replace(/^solana_/, '');
    if (!base || MAJOR_MINTS.has(base) || !MAJOR_MINTS.has(quote)) return null;
    const a = item.attributes ?? {};
    return {
      mint: base,
      createdAt: Date.parse(a.pool_created_at) || 0,
      liquidityUsd: n(a.reserve_in_usd),
    };
  }

  /** Returns [{mint, createdAt, liquidityUsd, source}] of young tokens. */
  async function discover(cfg, isStopped = () => false) {
    const found = [];
    const urls = [];
    for (let p = 1; p <= cfg.geckoNewPoolPages; p++) urls.push(['gecko-new', `${GECKO}/new_pools?page=${p}`]);
    if (cfg.useGeckoTrending) urls.push(['gecko-trending', `${GECKO}/trending_pools?duration=5m&page=1`]);

    for (const [source, url] of urls) {
      if (isStopped()) return found;
      try {
        const data = await get(geckoLimiter, url, isStopped);
        for (const item of data?.data ?? []) {
          const t = geckoPoolToMint(item);
          if (t) found.push({ ...t, source });
        }
      } catch (e) {
        log.warn(`Discovery ${source} failed: ${e.message}`);
      }
    }

    if (cfg.useDexscreenerProfiles) {
      for (const [source, url] of [
        ['dexs-profiles', `${DEXS}/token-profiles/latest/v1`],
        ['dexs-boosts', `${DEXS}/token-boosts/latest/v1`],
      ]) {
        if (isStopped()) return found;
        try {
          const data = await get(dexsLimiter, url, isStopped);
          for (const t of Array.isArray(data) ? data : []) {
            if (t?.chainId === 'solana' && t.tokenAddress && !MAJOR_MINTS.has(t.tokenAddress)) {
              found.push({ mint: t.tokenAddress, createdAt: 0, liquidityUsd: 0, source });
            }
          }
        } catch (e) {
          log.warn(`Discovery ${source} failed: ${e.message}`);
        }
      }
    }
    return found;
  }

  /** Normalizes a DexScreener pair into the shape used by the strategy. */
  function normalizePair(p) {
    return {
      mint: p.baseToken?.address,
      name: `${p.baseToken?.symbol ?? '?'}`.replace(/[,\n\r]/g, ' ').slice(0, 24),
      quoteMint: p.quoteToken?.address,
      dex: String(p.dexId ?? '').toLowerCase(),
      pairAddress: p.pairAddress,
      url: p.url,
      createdAt: n(p.pairCreatedAt),
      liquidityUsd: n(p.liquidity?.usd),
      mcapUsd: n(p.marketCap) || n(p.fdv),
      priceUsd: n(p.priceUsd),
      m5Change: n(p.priceChange?.m5),
      h1Change: n(p.priceChange?.h1),
      m5Buys: n(p.txns?.m5?.buys),
      m5Sells: n(p.txns?.m5?.sells),
      m5VolumeUsd: n(p.volume?.m5),
    };
  }

  /**
   * Fresh stats for many mints (30 per request). For each mint returns the
   * most liquid pair where the mint is the base token and quote is SOL/USDC/USDT.
   */
  async function getStats(mints, isStopped = () => false) {
    const out = new Map();
    for (let i = 0; i < mints.length; i += 30) {
      if (isStopped()) break;
      const chunk = mints.slice(i, i + 30);
      try {
        const pairs = await get(dexsLimiter, `${DEXS}/tokens/v1/solana/${chunk.join(',')}`, isStopped);
        for (const raw of Array.isArray(pairs) ? pairs : []) {
          const p = normalizePair(raw);
          if (!p.mint || !chunk.includes(p.mint) || !MAJOR_MINTS.has(p.quoteMint)) continue;
          const prev = out.get(p.mint);
          if (!prev || p.liquidityUsd > prev.liquidityUsd) out.set(p.mint, p);
        }
      } catch (e) {
        log.warn(`DexScreener stats failed: ${e.message}`);
      }
    }
    return out;
  }

  return { discover, getStats, normalizePair };
}
