export type NetworkId = "testnet" | "mainnet";

export type TradeSide = "buy" | "sell";

export type GuardDecision = "PASS" | "BLOCK";

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  intentsAssetId: string;
  /** NEP-141 contract id on NEAR (without nep141: prefix) for ORIGIN_CHAIN deposits */
  nearContractId?: string;
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
  /** Multi-agent consensus feeding the guardrail */
  votes?: AgentVote[];
  swarmAgreed?: boolean;
  /** Guardrailed agent spending (simulated micro-budget) */
  signalPayment?: SignalPayment;
  /** Risk inputs used by consensus (honest audit trail) */
  riskInputs?: {
    volatilityPct: number;
    drawdownPct: number;
    positionUsd: number;
  };
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
  dry: boolean;
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
  feeUsd?: number;
  feeBps?: number;
  slippageBps?: number;
  appFeeBps?: number;
  executionEnabled?: boolean;
  /** Present only on non-dry executable quotes */
  depositAddress?: string;
  depositMemo?: string;
  /** Contract to call for ORIGIN_CHAIN deposit (NEP-141) */
  depositContractId?: string;
  depositMethod?: "ft_transfer" | "native_transfer";
}

export interface BacktestTrade {
  at: string;
  side: "buy" | "skip";
  priceUsd: number;
  edgeBps: number;
  feeBps: number;
  pnlPct: number;
  win: boolean;
}

export interface BacktestResult {
  symbol: string;
  days: number;
  source: "coingecko" | "unavailable";
  feeBpsAssumed: number;
  trades: number;
  winRatePct: number | null;
  pnlAfterFeesPct: number | null;
  maxDrawdownPct: number | null;
  buyAndHoldPct: number | null;
  vsBuyAndHoldPct: number | null;
  label: string;
  disclaimer: string;
  points: number;
  sampleTrades: BacktestTrade[];
}
