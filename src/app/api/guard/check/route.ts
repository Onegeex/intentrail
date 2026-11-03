import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { resolveNetwork } from "@/lib/config";
import { checkProposal } from "@/lib/guardrails";
import type { TradeProposal } from "@/lib/types";
import { guardCheckBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public guardrail check for other agents.
 * POST a proposal-like body → PASS/BLOCK + reasons. Fail closed.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    name: "IntentRail guardrail seatbelt",
    method: "POST",
    body: {
      fromSymbol: "USDC",
      toSymbol: "NEAR",
      amountUsd: 5,
      slippageBps: 50,
      stopLossPct: 2,
      feeAwareOk: true,
      votes: [
        { agent: "trend", vote: "yes", reason: "..." },
        { agent: "risk", vote: "yes", reason: "..." },
      ],
    },
    returns: { decision: "PASS|BLOCK", reason: "string", checks: [] },
    snippet:
      'await fetch("/api/guard/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(proposal)})',
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "guard-check");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const parsed = guardCheckBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Validation failed", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const b = parsed.data;
  const proposal: TradeProposal = {
    id: b.id || randomUUID(),
    createdAt: new Date().toISOString(),
    side: b.side || "buy",
    fromSymbol: b.fromSymbol.toUpperCase(),
    toSymbol: b.toSymbol.toUpperCase(),
    amountUsd: b.amountUsd,
    amountIn: b.amountIn || String(Math.max(1, Math.round(b.amountUsd * 1e6))),
    estimatedOut: b.estimatedOut || "0",
    estimatedFeeUsd: b.estimatedFeeUsd ?? Number(((b.amountUsd * 20) / 10_000).toFixed(4)),
    slippageBps: b.slippageBps ?? 50,
    stopLossPct: b.stopLossPct ?? 2,
    trend: b.trend || "flat",
    rationale: b.rationale || "External agent proposal",
    feeAwareOk: b.feeAwareOk ?? true,
    network: b.network || resolveNetwork(),
    demo: b.demo ?? true,
    votes: b.votes,
    swarmAgreed: b.swarmAgreed ?? (b.votes ? b.votes.every((v) => v.vote === "yes") : true),
  };

  try {
    const guard = await checkProposal(proposal);
    return NextResponse.json({
      ok: true,
      decision: guard.decision,
      reason: guard.reason,
      checks: guard.checks,
      proposalId: guard.proposalId,
      integrateSnippet:
        'await fetch("/api/guard/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(proposal)})',
    });
  } catch (err) {
    return internalError("guard-check", err);
  }
}
