import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { HARD_CAPS, isExecutionEnabled } from "@/lib/config";
import { evaluateProposal } from "@/lib/guardrails";
import { requestExecutableQuote } from "@/lib/intents";
import { getProposal, isApproved } from "@/lib/store";
import { executePrepareBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prepare a real (non-dry) 1Click quote with deposit address.
 * Requires dual mainnet flags + human approval + explicit confirm flags.
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

  const parsed = executePrepareBodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Validation failed — confirmExecute + confirmMainnetCap required");

  if (!isExecutionEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Execution disabled on this deployment. Run locally with NEAR_NETWORK=mainnet and ALLOW_MAINNET=true. IntentRail never sets these on the public demo.",
        executionEnabled: false,
        maxMainnetSwapUsd: HARD_CAPS.maxMainnetSwapUsd,
      },
      { status: 403 },
    );
  }

  try {
    const proposal = await getProposal(parsed.data.proposalId);
    if (!proposal) return jsonError(404, "Proposal not found");

    if (!(await isApproved(proposal.id))) {
      return jsonError(403, "Human approval required before execute prepare");
    }

    if (proposal.amountUsd > HARD_CAPS.maxMainnetSwapUsd + 1e-9) {
      return jsonError(403, `Mainnet swap capped at $${HARD_CAPS.maxMainnetSwapUsd}`);
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
      accountId: parsed.data.accountId,
    });

    const guard = await evaluateProposal(proposal, quote, { forExecution: true });
    if (!quote.ok || guard.decision !== "PASS") {
      return NextResponse.json(
        {
          ok: false,
          error: quote.message || "Executable quote blocked",
          quote,
          guard,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
      quote,
      guard,
      instructions: {
        step1: "Review deposit address and amount (max $1).",
        step2: "Click Sign deposit — wallet signs ft_transfer; server never sees keys.",
        step3: "Poll status until SUCCESS / REFUNDED / FAILED.",
      },
      maxMainnetSwapUsd: HARD_CAPS.maxMainnetSwapUsd,
    });
  } catch (err) {
    return internalError("execute-prepare", err);
  }
}
