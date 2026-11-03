import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  enforceWalletRateLimit,
  jsonError,
  internalError,
} from "@/lib/api";
import {
  HARD_CAPS,
  isMainnetLiveAllowed,
} from "@/lib/config";
import { evaluateProposal } from "@/lib/guardrails";
import { requestExecutableQuote } from "@/lib/intents";
import {
  getProposal,
  getWalletSpentToday,
  recordSpend,
  recordWalletSpend,
  saveProposal,
} from "@/lib/store";
import type { TradeProposal } from "@/lib/types";
import { executePrepareBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prepare a real (non-dry) 1Click quote with deposit address.
 * Hosted Live mode: visitor opts in (liveMode + risk ack + wallet).
 * Server never signs and never moves funds.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "execute-prepare");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  // Missing wallet → clear connect error (not a cryptic flag message)
  const raw = body as { accountId?: unknown };
  if (!raw || typeof raw.accountId !== "string" || raw.accountId.trim().length < 2) {
    return jsonError(401, "Connect your NEAR wallet to prepare a live swap");
  }

  const parsed = executePrepareBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "Validation failed — need liveMode, mainnet, risk ack, and $1 cap confirm",
      {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    );
  }

  if (!isMainnetLiveAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Mainnet Live mode disabled by operator (MAINNET_DISABLED=true).",
        executionEnabled: false,
        maxMainnetSwapUsd: HARD_CAPS.maxMainnetSwapUsd,
      },
      { status: 403 },
    );
  }

  const accountId = parsed.data.accountId;
  const walletLimited = enforceWalletRateLimit(accountId, "execute-prepare");
  if (walletLimited) return walletLimited;

  try {
    let proposal: TradeProposal | null = null;
    if (parsed.data.proposal) {
      const p = parsed.data.proposal;
      proposal = {
        id: p.id,
        createdAt: p.createdAt || new Date().toISOString(),
        side: p.side,
        fromSymbol: p.fromSymbol,
        toSymbol: p.toSymbol,
        amountUsd: p.amountUsd,
        amountIn: p.amountIn,
        estimatedOut: p.estimatedOut,
        estimatedFeeUsd: p.estimatedFeeUsd,
        slippageBps: p.slippageBps,
        stopLossPct: p.stopLossPct,
        trend: p.trend,
        rationale: p.rationale,
        feeAwareOk: p.feeAwareOk,
        network: "mainnet",
        demo: false,
        votes: p.votes,
        swarmAgreed: true,
        riskInputs: p.riskInputs,
      };
      await saveProposal(proposal);
    } else if (parsed.data.proposalId) {
      proposal = await getProposal(parsed.data.proposalId);
    }

    if (!proposal) {
      return jsonError(404, "Proposal not found — propose again, then prepare");
    }

    if (proposal.amountUsd > HARD_CAPS.maxMainnetSwapUsd + 1e-9) {
      return jsonError(403, `Mainnet swap capped at $${HARD_CAPS.maxMainnetSwapUsd}`);
    }

    if (!proposal.swarmAgreed || !proposal.votes?.every((v) => v.vote === "yes")) {
      return jsonError(403, "Multi-agent consensus required before live prepare");
    }

    const walletSpent = await getWalletSpentToday(accountId);
    if (walletSpent + proposal.amountUsd > HARD_CAPS.maxMainnetWalletDailyUsd + 1e-9) {
      return jsonError(
        403,
        `Per-wallet daily mainnet cap $${HARD_CAPS.maxMainnetWalletDailyUsd} would be exceeded (used $${walletSpent.toFixed(2)})`,
      );
    }

    const preGuard = await evaluateProposal(proposal, null, { forExecution: true });
    if (preGuard.decision !== "PASS") {
      return NextResponse.json(
        { ok: false, error: "Guardrails BLOCKED execution", guard: preGuard },
        { status: 403 },
      );
    }

    const quote = await requestExecutableQuote({
      proposal,
      accountId,
    });

    // Fail closed: depositAddress must be from 1Click and amount within cap
    if (
      !quote.ok ||
      quote.dry !== false ||
      !quote.depositAddress ||
      !quote.amountIn ||
      !quote.depositContractId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: quote.message || "Executable quote missing deposit fields",
          quote,
        },
        { status: 403 },
      );
    }

    const quotedUsd = Number(quote.amountInUsd ?? proposal.amountUsd);
    if (!Number.isFinite(quotedUsd) || quotedUsd > HARD_CAPS.maxMainnetSwapUsd + 0.05) {
      return jsonError(403, "Quoted amount failed mainnet $1 cap re-check");
    }

    const guard = await evaluateProposal(proposal, quote, { forExecution: true });
    if (guard.decision !== "PASS") {
      return NextResponse.json(
        {
          ok: false,
          error: "Guardrails BLOCKED executable quote",
          quote,
          guard,
        },
        { status: 403 },
      );
    }

    // Reserve wallet + global budget for this prepare
    await recordWalletSpend(accountId, proposal.amountUsd);
    await recordSpend(proposal.amountUsd);

    return NextResponse.json({
      ok: true,
      quote,
      guard,
      accountId,
      walletSpentToday: walletSpent + proposal.amountUsd,
      maxMainnetSwapUsd: HARD_CAPS.maxMainnetSwapUsd,
      maxMainnetWalletDailyUsd: HARD_CAPS.maxMainnetWalletDailyUsd,
      instructions: {
        step1: "Re-check deposit address + amount on screen (max $1).",
        step2: "Sign deposit in your wallet — server never sees keys.",
        step3: "Status polls until SUCCESS / REFUNDED / FAILED.",
      },
    });
  } catch (err) {
    return internalError("execute-prepare", err);
  }
}
