export type NetworkId = "testnet" | "mainnet";

export type TradeSide = "buy" | "sell";

export type GuardDecision = "PASS" | "BLOCK";

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  /** CoinGecko id for public prices */
  coingeckoId: string;
  /** NEAR Intents asset id (nep141:...) used for 1Click quotes */
  intentsAssetId: string;
  decimals: number;
  /** Allowed on testnet demo even if Intents is mainnet-only */
  allowlisted: true;
}

export interface PriceSnapshot {
  symbol: string;
  priceUsd: number;
  change24hPct: number;
  source: "coingecko" | "demo";
  asOf: string;
}

export interface TradeProposal {
  id: string;
  createdAt: string;
  side: TradeSide;
  fromSymbol: string;
  toSymbol: string;
  amountUsd: number;
  amountIn: string;
  estimatedOut: string;
  estimatedFeeUsd: number;
  slippageBps: number;
  stopLossPct: number;
  trend: "up" | "down" | "flat";
  rationale: string;
  /** Fee-aware: only propose when estimated edge > fee */
  feeAwareOk: boolean;
  network: NetworkId;
  demo: boolean;
}

export interface GuardCheck {
  code: string;
  ok: boolean;
  detail: string;
}

export interface GuardResult {
  decision: GuardDecision;
  reason: string;
  checks: GuardCheck[];
  proposalId: string;
}

export interface GuardrailPolicy {
  maxLossPerTradeUsd: number;
  dailySpendCapUsd: number;
  maxSlippageBps: number;
  requireHumanApproval: boolean;
  allowlistedSymbols: string[];
  killSwitch: boolean;
}

export interface QuoteResult {
  dry: true;
  ok: boolean;
  message: string;
  amountIn?: string;
  amountOut?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  timeEstimateSec?: number;
  correlationId?: string;
  stub?: boolean;
}
