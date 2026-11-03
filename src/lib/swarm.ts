import type { AgentVote, PriceSnapshot, TradeSide } from "./types";

/**
 * AI Swarms — two agents vote independently. Proposal needs both "yes".
 * Deterministic rules (no paid API). Optional NEAR AI can enrich reasons later.
 */
export function trendAgentVote(input: {
  side: TradeSide;
  toPrice: PriceSnapshot;
}): AgentVote {
  const ch = input.toPrice.change24hPct;
  if (input.side === "buy") {
    if (ch > 1.5) {
      return {
        agent: "trend",
        vote: "yes",
        reason: `Uptrend (+${ch.toFixed(2)}% 24h) supports a buy.`,
      };
    }
    if (ch < -1.5) {
      return {
        agent: "trend",
        vote: "no",
        reason: `Downtrend (${ch.toFixed(2)}% 24h) — trend agent rejects buy.`,
      };
    }
    return {
      agent: "trend",
      vote: "yes",
      reason: `Flat (${ch.toFixed(2)}% 24h) — small probe allowed by trend agent.`,
    };
  }
  // sell
  if (ch < -1.5) {
    return {
      agent: "trend",
      vote: "yes",
      reason: `Downtrend (${ch.toFixed(2)}%) — rotate/sell aligned with trend.`,
    };
  }
  if (ch > 1.5) {
    return {
      agent: "trend",
      vote: "no",
      reason: `Uptrend (+${ch.toFixed(2)}%) — trend agent rejects sell into strength.`,
    };
  }
  return {
    agent: "trend",
    vote: "yes",
    reason: `Flat market — sell/rotate probe acceptable.`,
  };
}

export function riskAgentVote(input: {
  amountUsd: number;
  stopLossPct: number;
  maxLossPerTradeUsd: number;
  feeAwareOk: boolean;
}): AgentVote {
  const risk = input.amountUsd * (input.stopLossPct / 100);
  if (risk > input.maxLossPerTradeUsd + 1e-9) {
    return {
      agent: "risk",
      vote: "no",
      reason: `Stop risk $${risk.toFixed(2)} exceeds max loss $${input.maxLossPerTradeUsd}.`,
    };
  }
  if (!input.feeAwareOk) {
    return {
      agent: "risk",
      vote: "no",
      reason: "Fee-aware filter failed — edge does not cover assumed fees.",
    };
  }
  if (input.amountUsd > 25) {
    return {
      agent: "risk",
      vote: "no",
      reason: `Size $${input.amountUsd} above risk agent's soft cap ($25).`,
    };
  }
  return {
    agent: "risk",
    vote: "yes",
    reason: `Risk $${risk.toFixed(2)} within $${input.maxLossPerTradeUsd}; fees OK.`,
  };
}

export function swarmAgree(votes: AgentVote[]): boolean {
  return votes.length >= 2 && votes.every((v) => v.vote === "yes");
}
