import { HARD_CAPS } from "./config";
import { getPolicy, getSpentToday } from "./store";
import { isAllowlistedSymbol } from "./tokens";
import type { GuardCheck, GuardResult, QuoteResult, TradeProposal } from "./types";

/**
 * Server-side guardrail engine. Fail closed: any failed check => BLOCK.
 * Optional real dry-quote tightens FEE_AWARE / SLIPPAGE using live numbers.
 */
export async function evaluateProposal(
  proposal: TradeProposal,
  quote?: QuoteResult | null,
): Promise<GuardResult> {
  const policy = await getPolicy();
  const spent = await getSpentToday();
  const checks: GuardCheck[] = [];

  const push = (code: string, ok: boolean, detail: string) => {
    checks.push({ code, ok, detail });
  };

  push(
    "KILL_SWITCH",
    !policy.killSwitch,
    policy.killSwitch
      ? "Kill switch is ON — all trading blocked"
      : "Kill switch off",
  );

  const fromOk = isAllowlistedSymbol(proposal.fromSymbol);
  const toOk = isAllowlistedSymbol(proposal.toSymbol);
  push(
    "ALLOWLIST",
    fromOk && toOk,
    fromOk && toOk
      ? `${proposal.fromSymbol}→${proposal.toSymbol} allowlisted`
      : "Token pair not on allowlist",
  );

  const amountOk =
    Number.isFinite(proposal.amountUsd) &&
    proposal.amountUsd >= HARD_CAPS.minTradeUsd &&
    proposal.amountUsd <= HARD_CAPS.maxTradeUsd;
  push(
    "AMOUNT_BOUNDS",
    amountOk,
    amountOk
      ? `$${proposal.amountUsd} within $${HARD_CAPS.minTradeUsd}–$${HARD_CAPS.maxTradeUsd}`
      : "Amount outside hard caps",
  );

  const riskUsd = proposal.amountUsd * (proposal.stopLossPct / 100);
  const lossOk = riskUsd <= policy.maxLossPerTradeUsd + 1e-9;
  push(
    "MAX_LOSS",
    lossOk,
    `Estimated stop risk $${riskUsd.toFixed(2)} vs max $${policy.maxLossPerTradeUsd}`,
  );

  const dailyOk = spent + proposal.amountUsd <= policy.dailySpendCapUsd + 1e-9;
  push(
    "DAILY_CAP",
    dailyOk,
    `Spent today $${spent.toFixed(2)} + $${proposal.amountUsd} vs cap $${policy.dailySpendCapUsd}`,
  );

  const slipBps = quote?.slippageBps ?? proposal.slippageBps;
  const slipOk = slipBps <= policy.maxSlippageBps;
  push(
    "SLIPPAGE",
    slipOk,
    quote && !quote.simulated
      ? `Quote slippage ${slipBps} bps vs max ${policy.maxSlippageBps} bps (live dry quote)`
      : `${slipBps} bps vs max ${policy.maxSlippageBps} bps`,
  );

  // Fee-aware: prefer real quote fee bps when available
  let feeOk = proposal.feeAwareOk;
  let feeDetail = proposal.feeAwareOk
    ? "Estimated edge covers fees"
    : "Blocked: estimated edge does not cover fees";
  if (quote?.ok && typeof quote.feeBps === "number") {
    feeOk = quote.feeBps <= HARD_CAPS.maxFeeBps;
    feeDetail = quote.simulated
      ? `Simulated fee ~${quote.feeBps} bps (max ${HARD_CAPS.maxFeeBps})`
      : `Live quote fee ~${quote.feeBps} bps / $${quote.feeUsd?.toFixed(4) ?? "?"} (max ${HARD_CAPS.maxFeeBps} bps)`;
  }
  push("FEE_AWARE", feeOk, feeDetail);

  if (quote) {
    push(
      "QUOTE_DRY",
      quote.dry === true && quote.ok,
      quote.simulated
        ? "Simulated dry quote (fallback)"
        : "Live 1Click dry quote (no deposit address)",
    );
    push(
      "EXECUTION_GATE",
      true,
      quote.executionEnabled
        ? "Mainnet execution flags ON — still requires human approval + wallet sign"
        : "Execution disabled (testnet default / dual flag off) — quote is read-only",
    );
  }

  // Swarm: both Trend + Risk must vote yes
  const votes = proposal.votes || [];
  const swarmOk =
    proposal.swarmAgreed === true ||
    (votes.length >= 2 && votes.every((v) => v.vote === "yes"));
  push(
    "SWARM_AGREE",
    swarmOk,
    swarmOk
      ? "Trend + Risk agents both voted yes"
      : `Swarm rejected: ${votes.map((v) => `${v.agent}=${v.vote}`).join(", ") || "no votes"}`,
  );

  push(
    "HUMAN_APPROVAL_POLICY",
    true,
    policy.requireHumanApproval
      ? "Human approval required before any sign/execute"
      : "Human approval policy relaxed (still recommended)",
  );

  push(
    "DISTINCT_ASSETS",
    proposal.fromSymbol.toUpperCase() !== proposal.toSymbol.toUpperCase(),
    "From and to must differ",
  );

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    return {
      decision: "BLOCK",
      reason: failed.map((f) => `${f.code}: ${f.detail}`).join("; "),
      checks,
      proposalId: proposal.id,
    };
  }

  return {
    decision: "PASS",
    reason: "All guardrail checks passed",
    checks,
    proposalId: proposal.id,
  };
}
