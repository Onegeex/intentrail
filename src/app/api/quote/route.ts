import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { evaluateProposal } from "@/lib/guardrails";
import { requestDryQuote } from "@/lib/intents";
import { getProposal, getPolicy, isApproved } from "@/lib/store";
import { quoteBodySchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Dry-quote only. Never creates a live deposit address from this route.
 * Re-checks guardrails + human approval before calling Intents.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "quote");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const parsed = quoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Validation failed", {
      issues: parsed.error.issues,
    });
  }

  const proposal = await getProposal(parsed.data.proposalId);
  if (!proposal) return jsonError(404, "Proposal not found");

  const policy = await getPolicy();
  if (policy.requireHumanApproval) {
    const approved = await isApproved(proposal.id);
    if (!approved) {
      return jsonError(403, "Human approval required before quote");
    }
  }

  // Re-evaluate immediately before any external call (fail closed)
  const guard = await evaluateProposal(proposal);
  if (guard.decision !== "PASS") {
    return NextResponse.json(
      { ok: false, error: "Blocked by guardrails", guard },
      { status: 403 },
    );
  }

  const quote = await requestDryQuote(proposal);
  return NextResponse.json({ ok: quote.ok, guard, quote, proposalId: proposal.id });
}
