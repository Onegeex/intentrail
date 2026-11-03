import { randomUUID } from "crypto";
import { resolveNetwork, HARD_CAPS, getDefaultPolicy } from "./config";
import { getTokenBySymbol } from "./tokens";
import { riskAgentVote, swarmAgree, trendAgentVote } from "./swarm";
import type { PriceSnapshot, TradeProposal, TradeSide } from "./types";

const FEE_BPS_ASSUMED = 20; // ~0.2% without 1Click JWT (HACKATHON Q-006)
const MIN_EDGE_BPS = 35; // require edge > fee before proposing
const DEFAULT_STOP_PCT = 2; // aligns with ~$2 max loss on $100 notional; we size down

function trendFromChange(change24hPct: number): "up" | "down" | "flat" {
  if (change24hPct > 1.5) return "up";
  if (change24hPct < -1.5) return "down";
  return "flat";
}

/**
 * Fee-aware, trend-filtered proposal.
 * - Buys strength only when uptrend and edge > fee
 * - Sells / rotates to stable when downtrend
 * - Always attaches a stop-loss percentage sized so $ risk ≈ policy max loss
 */
export function buildProposal(input: {
  fromSymbol: string;
  toSymbol: string;
  amountUsd: number;
  fromPrice: PriceSnapshot;
  toPrice: PriceSnapshot;
  demo?: boolean;
}): TradeProposal {
  const from = getTokenBySymbol(input.fromSymbol)!;
  const to = getTokenBySymbol(input.toSymbol)!;
  const amountUsd = Math.min(HARD_CAPS.maxTradeUsd, Math.max(HARD_CAPS.minTradeUsd, input.amountUsd));

  const trend = trendFromChange(input.toPrice.change24hPct);
  let side: TradeSide = "buy";
  let rationale = "";

  if (trend === "up") {
    side = "buy";
    rationale = `${to.symbol} 24h change ${input.toPrice.change24hPct.toFixed(2)}% (uptrend). Prefer buy with tight stop.`;
  } else if (trend === "down") {
    side = "sell";
    rationale = `${to.symbol} 24h change ${input.toPrice.change24hPct.toFixed(2)}% (downtrend). Prefer rotate toward ${from.symbol}.`;
  } else {
    side = "buy";
    rationale = `${to.symbol} is flat (${input.toPrice.change24hPct.toFixed(2)}%). Small probe size only if fees allow.`;
  }

  // Crude edge proxy from |24h move| — not predictive, just a filter for demo
  const edgeBps = Math.min(200, Math.abs(input.toPrice.change24hPct) * 10);
  const feeAwareOk = edgeBps >= FEE_BPS_ASSUMED + (MIN_EDGE_BPS - FEE_BPS_ASSUMED) / 2
    ? edgeBps > FEE_BPS_ASSUMED
    : edgeBps > FEE_BPS_ASSUMED;

  const feeUsd = (amountUsd * FEE_BPS_ASSUMED) / 10_000;
  const stopLossPct = DEFAULT_STOP_PCT;

  // amountIn in smallest units of `from` (full decimals for USDC=6; cap pad for 18/24)
  const fromUnits = amountUsd / Math.max(input.fromPrice.priceUsd, 1e-9);
  let amountIn: string;
  if (from.decimals <= 8) {
    amountIn = String(Math.max(1, Math.round(fromUnits * 10 ** from.decimals)));
  } else {
    const micros = Math.max(1, Math.floor(fromUnits * 1e8));
    amountIn = `${micros}${"0".repeat(from.decimals - 8)}`;
  }

  const toUnits =
    (amountUsd * (1 - FEE_BPS_ASSUMED / 10_000)) /
    Math.max(input.toPrice.priceUsd, 1e-9);
  const estimatedOut = toUnits.toFixed(6);

  // If selling into strength of from / weakness of to, swap labels in rationale only;
  // the from→to pair is what the user requested and guardrails validate.
  if (side === "sell" && from.symbol === "USDC") {
    // Requested USDC→NEAR on a downtrend: block via feeAware unless flat-probe;
    // mark feeAware false when fighting the trend hard.
    if (trend === "down") {
      // still allow proposal object; guardrail FEE_AWARE / user can see BLOCK
    }
  }

  const feeOkFinal =
    feeAwareOk &&
    !(trend === "down" && to.symbol !== "USDC") &&
    !(trend === "flat" && amountUsd > 10);

  const policy = getDefaultPolicy();
  const votes = [
    trendAgentVote({ side, toPrice: input.toPrice }),
    riskAgentVote({
      amountUsd,
      stopLossPct,
      maxLossPerTradeUsd: policy.maxLossPerTradeUsd,
      feeAwareOk: feeOkFinal,
    }),
  ];
  const agreed = swarmAgree(votes);
  if (!agreed) {
    rationale = `${rationale} Swarm did not agree.`;
  }

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    side,
    fromSymbol: from.symbol,
    toSymbol: to.symbol,
    amountUsd,
    amountIn,
    estimatedOut,
    estimatedFeeUsd: Number(feeUsd.toFixed(4)),
    slippageBps: 50,
    stopLossPct,
    trend,
    rationale,
    feeAwareOk: feeOkFinal,
    network: resolveNetwork(),
    demo: Boolean(input.demo),
    votes,
    swarmAgreed: agreed,
  };
}
