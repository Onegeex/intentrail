import { HARD_CAPS } from "./config";
import { getPolicy, getSpentToday } from "./store";
import { isAllowlistedSymbol } from "./tokens";
import type { GuardCheck, GuardResult, TradeProposal } from "./types";

/**
 * Server-side guardrail engine. Fail closed: any failed check => BLOCK.
 * Must be re-run immediately before any signing / quote execution.
 */
export async function evaluateProposal(proposal: TradeProposal): Promise<GuardResult> {
  const policy = await getPolicy();
  const spent = await getSpentToday();
  const checks: GuardCheck[] = [];

  const push = (code: string, ok: boolean, detail: string) => {
    checks.push({ code, ok, detail });
  };

  // 1. Kill switch
  push(
    "KILL_SWITCH",
    !policy.killSwitch,
    policy.killSwitch
      ? "Kill switch is ON — all trading blocked"
      : "Kill switch off",
  );

  // 2. Allowlist
  const fromOk = isAllowlistedSymbol(proposal.fromSymbol);
  const toOk = isAllowlistedSymbol(proposal.toSymbol);
  push(
    "ALLOWLIST",
    fromOk && toOk,
    fromOk && toOk
      ? `${proposal.fromSymbol}→${proposal.toSymbol} allowlisted`
      : "Token pair not on allowlist",
  );

  // 3. Amount bounds
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

  // 4. Max loss per trade (stop-loss sized notional risk)
  const riskUsd = proposal.amountUsd * (proposal.stopLossPct / 100);
  const lossOk = riskUsd <= policy.maxLossPerTradeUsd + 1e-9;
  push(
    "MAX_LOSS",
    lossOk,
    `Estimated stop risk $${riskUsd.toFixed(2)} vs max $${policy.maxLossPerTradeUsd}`,
  );

  // 5. Daily spend cap
  const dailyOk = spent + proposal.amountUsd <= policy.dailySpendCapUsd + 1e-9;
  push(
    "DAILY_CAP",
    dailyOk,
    `Spent today $${spent.toFixed(2)} + $${proposal.amountUsd} vs cap $${policy.dailySpendCapUsd}`,
  );

  // 6. Slippage cap
  const slipOk = proposal.slippageBps <= policy.maxSlippageBps;
  push(
    "SLIPPAGE",
    slipOk,
    `${proposal.slippageBps} bps vs max ${policy.maxSlippageBps} bps`,
  );

  // 7. Fee-aware filter
  push(
    "FEE_AWARE",
    proposal.feeAwareOk,
    proposal.feeAwareOk
      ? "Estimated edge covers fees"
      : "Blocked: estimated edge does not cover fees",
  );

  // 8. Human approval required (decision layer — UI must still click Approve)
  push(
    "HUMAN_APPROVAL_POLICY",
    true,
    policy.requireHumanApproval
      ? "Human approval required before any sign/execute"
      : "Human approval policy relaxed (still recommended)",
  );

  // 9. Same-asset nonsense
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
