import type { TokenInfo } from "./types";

/**
 * Strict allowlist. Trade APIs refuse any symbol not in this set.
 * Intents asset ids are mainnet 1Click identifiers (HACKATHON Q-007: no Intents testnet).
 */
export const ALLOWLISTED_TOKENS: readonly TokenInfo[] = [
  {
    id: "near",
    symbol: "NEAR",
    name: "NEAR",
    coingeckoId: "near",
    intentsAssetId: "nep141:wrap.near",
    decimals: 24,
    allowlisted: true,
  },
  {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    coingeckoId: "usd-coin",
    // Native USDC on NEAR (from 1Click /v0/tokens)
    intentsAssetId:
      "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    decimals: 6,
    allowlisted: true,
  },
  {
    id: "weth",
    symbol: "WETH",
    name: "Wrapped Ether",
    coingeckoId: "weth",
    intentsAssetId: "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near",
    decimals: 18,
    allowlisted: true,
  },
  {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    coingeckoId: "ethereum",
    intentsAssetId: "nep141:eth.omft.near",
    decimals: 18,
    allowlisted: true,
  },
  {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    coingeckoId: "bitcoin",
    intentsAssetId: "nep141:btc.omft.near",
    decimals: 8,
    allowlisted: true,
  },
] as const;

export const PRICE_FEED_SYMBOLS = ["NEAR", "USDC", "BTC", "ETH"] as const;

export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  const s = symbol.trim().toUpperCase();
  return ALLOWLISTED_TOKENS.find((t) => t.symbol === s);
}

export function isAllowlistedSymbol(symbol: string): boolean {
  return Boolean(getTokenBySymbol(symbol));
}

export const ALLOWLISTED_SYMBOLS = ALLOWLISTED_TOKENS.map((t) => t.symbol);
