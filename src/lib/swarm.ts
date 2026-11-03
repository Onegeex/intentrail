import type { AgentVote, PriceSnapshot, TradeSide } from "./types";

/**
 * Multi-agent consensus feeding the guardrail (Trend + Risk).
 * Both must vote yes before CONSENSUS check can PASS.
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
        reason: `Downtrend (${ch.toFixed(2)}% 24h) — trend rejects buy.`,
      };
    }
    return {
      agent: "trend",
      vote: "yes",
      reason: `Flat (${ch.toFixed(2)}% 24h) — small probe allowed.`,
    };
  }
  if (ch < -1.5) {
    return {
      agent: "trend",
      vote: "yes",
      reason: `Downtrend (${ch.toFixed(2)}%) — rotate/sell aligned.`,
    };
  }
  if (ch > 1.5) {
    return {
      agent: "trend",
      vote: "no",
      reason: `Uptrend (+${ch.toFixed(2)}%) — rejects sell into strength.`,
    };
  }
  return {
    agent: "trend",
    vote: "yes",
    reason: `Flat market — sell/rotate probe acceptable.`,
  };
}

/** Approx realized vol proxy from |24h change| (honest, not GARCH). */
export function estimateVolatilityPct(change24hPct: number): number {
  return Math.min(80, Math.abs(change24hPct) * 1.2);
}

/** Soft drawdown proxy: adverse move vs stop. */
export function estimateDrawdownPct(change24hPct: number, stopLossPct: number): number {
  const adverse = change24hPct < 0 ? Math.abs(change24hPct) : 0;
  return Math.max(adverse, stopLossPct * 0.5);
}

export function riskAgentVote(input: {
  amountUsd: number;
  stopLossPct: number;
  maxLossPerTradeUsd: number;
  feeAwareOk: boolean;
  volatilityPct: number;
  drawdownPct: number;
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
  if (input.volatilityPct > 25) {
    return {
      agent: "risk",
      vote: "no",
      reason: `Volatility ~${input.volatilityPct.toFixed(1)}% too high for size $${input.amountUsd}.`,
    };
  }
  if (input.drawdownPct > input.stopLossPct * 1.5) {
    return {
      agent: "risk",
      vote: "no",
      reason: `Drawdown proxy ${input.drawdownPct.toFixed(1)}% vs stop ${input.stopLossPct}%.`,
    };
  }
  if (input.amountUsd > 25) {
    return {
      agent: "risk",
      vote: "no",
      reason: `Position $${input.amountUsd} above risk soft cap ($25).`,
    };
  }
  return {
    agent: "risk",
    vote: "yes",
    reason:
      `Risk $${risk.toFixed(2)} within $${input.maxLossPerTradeUsd}; ` +
      `vol ~${input.volatilityPct.toFixed(1)}%; dd ~${input.drawdownPct.toFixed(1)}%; size $${input.amountUsd}.`,
  };
}

export function swarmAgree(votes: AgentVote[]): boolean {
  return votes.length >= 2 && votes.every((v) => v.vote === "yes");
}
