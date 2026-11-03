export type NetworkId = "testnet" | "mainnet";

export type TradeSide = "buy" | "sell";

export type GuardDecision = "PASS" | "BLOCK";

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  intentsAssetId: string;
  decimals: number;
  allowlisted: true;
}

export interface PriceSnapshot {
  symbol: string;
  priceUsd: number;
  change24hPct: number;
  source: "coingecko" | "demo";
  asOf: string;
}

export type AgentVoteDecision = "yes" | "no";

export interface AgentVote {
  agent: "trend" | "risk";
  vote: AgentVoteDecision;
  reason: string;
}

export interface SignalPayment {
  ok: boolean;
  simulated: boolean;
  amountUsd: number;
  reason: string;
  premiumHint?: string;
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
  feeAwareOk: boolean;
  network: NetworkId;
  demo: boolean;
  /** AI Swarms: both agents must vote yes before guardrails can PASS */
  votes?: AgentVote[];
  swarmAgreed?: boolean;
  /** Agent Economy: guardrailed micro-payment for premium signal */
  signalPayment?: SignalPayment;
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
  /** true = mock/simulated fallback (not a live 1Click response) */
  simulated: boolean;
  stub?: boolean;
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  minAmountOut?: string;
  timeEstimateSec?: number;
  correlationId?: string;
  deadline?: string;
  /** Estimated fee in USD from quote in/out delta */
  feeUsd?: number;
  /** Fee as bps of amountInUsd */
  feeBps?: number;
  /** Slippage tolerance requested (bps) */
  slippageBps?: number;
  /** App fee from quoteRequest if present */
  appFeeBps?: number;
  executionEnabled?: boolean;
}
