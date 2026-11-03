import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { evaluateProposal } from "@/lib/guardrails";
import { requestDryQuote } from "@/lib/intents";
import { getProposal } from "@/lib/store";
import { quoteBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dry-quote only (read-only). Never creates a deposit address.
 * Human approval is required for execute — not for dry quotes.
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
    return jsonError(400, "Validation failed");
  }

  try {
    const proposal = await getProposal(parsed.data.proposalId);
    if (!proposal) return jsonError(404, "Proposal not found");

    // Base guardrails without quote first (kill switch / allowlist)
    const baseGuard = await evaluateProposal(proposal);
    const blockedHard = baseGuard.checks.some(
      (c) =>
        !c.ok &&
        (c.code === "KILL_SWITCH" ||
          c.code === "ALLOWLIST" ||
          c.code === "AMOUNT_BOUNDS" ||
          c.code === "DISTINCT_ASSETS"),
    );
    if (blockedHard) {
      return NextResponse.json(
        { ok: false, error: "Blocked by guardrails", guard: baseGuard },
        { status: 403 },
      );
    }

    const quote = await requestDryQuote(proposal);
    const guard = await evaluateProposal(proposal, quote);

    return NextResponse.json({
      ok: quote.ok,
      guard,
      quote,
      proposalId: proposal.id,
    });
  } catch (err) {
    return internalError("quote", err);
  }
}
