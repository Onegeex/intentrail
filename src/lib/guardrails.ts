import { HARD_CAPS, isMainnetLiveAllowed } from "./config";
import { getPolicy, getSpentToday } from "./store";
import { isAllowlistedSymbol } from "./tokens";
import type { GuardCheck, GuardResult, QuoteResult, TradeProposal } from "./types";

export type EvaluateOptions = {
  /** When true, expect/allow non-dry executable quote checks */
  forExecution?: boolean;
};

/**
 * Fail-closed guardrail engine — reusable by IntentRail and external agents.
 * Any failed check => BLOCK.
 */
export async function evaluateProposal(
  proposal: TradeProposal,
  quote?: QuoteResult | null,
  opts?: EvaluateOptions,
): Promise<GuardResult> {
  const policy = await getPolicy();
  const spent = await getSpentToday();
  const checks: GuardCheck[] = [];
  const forExecution = Boolean(opts?.forExecution);

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

  // Real mainnet execution hard cap ($1)
  if (forExecution || (quote && quote.dry === false)) {
    const execCapOk = proposal.amountUsd <= HARD_CAPS.maxMainnetSwapUsd + 1e-9;
    push(
      "MAINNET_SWAP_CAP",
      execCapOk,
      execCapOk
        ? `Within mainnet per-swap cap $${HARD_CAPS.maxMainnetSwapUsd}`
        : `Blocked: mainnet per-swap cap is $${HARD_CAPS.maxMainnetSwapUsd}`,
    );
    push(
      "EXECUTION_FLAGS",
      isMainnetLiveAllowed(),
      isMainnetLiveAllowed()
        ? "Operator allows mainnet Live mode (MAINNET_DISABLED off)"
        : "Operator disabled mainnet (MAINNET_DISABLED=true)",
    );
  }

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
    `${slipBps} bps vs max ${policy.maxSlippageBps} bps`,
  );

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
    if (forExecution || quote.dry === false) {
      push(
        "QUOTE_EXECUTABLE",
        quote.ok && quote.dry === false && Boolean(quote.depositAddress),
        quote.ok && quote.depositAddress
          ? "Non-dry 1Click quote with deposit address"
          : quote.message || "Executable quote missing deposit address",
      );
    } else {
      push(
        "QUOTE_DRY",
        quote.dry === true && quote.ok,
        quote.simulated
          ? "Simulated dry quote (fallback)"
          : "Live 1Click dry quote (no deposit address)",
      );
    }
    push(
      "EXECUTION_GATE",
      true,
      quote.executionEnabled
        ? "Mainnet execution flags ON — still requires explicit user click + wallet sign"
        : "Execution disabled (testnet default / dual flag off) — quote is read-only",
    );
  }

  // Multi-agent consensus → guardrail input
  const votes = proposal.votes || [];
  const swarmOk =
    proposal.swarmAgreed === true ||
    (votes.length >= 2 && votes.every((v) => v.vote === "yes"));
  push(
    "CONSENSUS",
    swarmOk,
    swarmOk
      ? "Multi-agent consensus (Trend + Risk) agreed"
      : `Consensus rejected: ${votes.map((v) => `${v.agent}=${v.vote}`).join(", ") || "no votes"}`,
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

/** Alias for external agents — same fail-closed engine. */
export const checkProposal = evaluateProposal;
