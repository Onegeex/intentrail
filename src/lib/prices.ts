import { getTokenBySymbol, ALLOWLISTED_TOKENS, PRICE_FEED_SYMBOLS } from "./tokens";
import type { PriceSnapshot } from "./types";

const DEMO_PRICES: Record<string, { price: number; change: number }> = {
  NEAR: { price: 3.42, change: 2.8 },
  USDC: { price: 1, change: 0.01 },
  WETH: { price: 3200, change: -1.2 },
  ETH: { price: 3200, change: -1.2 },
  BTC: { price: 95000, change: 0.8 },
};

type CacheEntry = {
  at: number;
  prices: PriceSnapshot[];
  degraded: boolean;
};

const CACHE_TTL_MS = 15_000;
let cache: CacheEntry | null = null;

export async function fetchPrices(
  symbols: string[],
  opts?: { demo?: boolean; bypassCache?: boolean },
): Promise<{ prices: PriceSnapshot[]; degraded: boolean; cached: boolean; asOf: string }> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  for (const s of unique) {
    if (!getTokenBySymbol(s)) {
      throw new Error(`Symbol not allowlisted: ${s}`);
    }
  }

  if (opts?.demo) {
    const prices = unique.map((symbol) => {
      const d = DEMO_PRICES[symbol] || { price: 1, change: 0 };
      return {
        symbol,
        priceUsd: d.price,
        change24hPct: d.change,
        source: "demo" as const,
        asOf: new Date().toISOString(),
      };
    });
    return {
      prices,
      degraded: true,
      cached: false,
      asOf: prices[0]?.asOf || new Date().toISOString(),
    };
  }

  const now = Date.now();
  if (
    !opts?.bypassCache &&
    cache &&
    now - cache.at < CACHE_TTL_MS &&
    unique.every((s) => cache!.prices.some((p) => p.symbol === s))
  ) {
    const filtered = unique.map(
      (s) => cache!.prices.find((p) => p.symbol === s)!,
    );
    return {
      prices: filtered,
      degraded: cache.degraded,
      cached: true,
      asOf: filtered[0]?.asOf || new Date(cache.at).toISOString(),
    };
  }

  const ids = unique
    .map((s) => getTokenBySymbol(s)!.coingeckoId)
    .join(",");

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;

    const asOf = new Date().toISOString();
    let degraded = false;
    const prices = unique.map((symbol) => {
      const t = getTokenBySymbol(symbol)!;
      const row = data[t.coingeckoId];
      if (!row?.usd) {
        degraded = true;
        const d = DEMO_PRICES[symbol];
        return {
          symbol,
          priceUsd: d?.price ?? 1,
          change24hPct: d?.change ?? 0,
          source: "demo" as const,
          asOf,
        };
      }
      return {
        symbol,
        priceUsd: row.usd,
        change24hPct: row.usd_24h_change ?? 0,
        source: "coingecko" as const,
        asOf,
      };
    });

    // Merge into cache so partial requests still help
    const bySym = new Map((cache?.prices || []).map((p) => [p.symbol, p]));
    for (const p of prices) bySym.set(p.symbol, p);
    cache = {
      at: now,
      prices: [...bySym.values()],
      degraded,
    };

    return { prices, degraded, cached: false, asOf };
  } catch {
    const fallback = await fetchPrices(symbols, { demo: true });
    cache = {
      at: now,
      prices: fallback.prices,
      degraded: true,
    };
    return { ...fallback, degraded: true, cached: false };
  }
}

export function listAllowlistedForClient() {
  return ALLOWLISTED_TOKENS.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
  }));
}

export function defaultPriceSymbols(): string[] {
  return [...PRICE_FEED_SYMBOLS];
}
