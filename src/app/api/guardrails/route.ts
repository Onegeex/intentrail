import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { HARD_CAPS, resolveNetwork } from "@/lib/config";
import { evaluateProposal } from "@/lib/guardrails";
import { getPolicy, getProposal, getSpentToday, markApproved } from "@/lib/store";
import { approveBodySchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "guardrails-get");
  if (limited) return limited;

  const policy = await getPolicy();
  const spentUsdToday = await getSpentToday();
  return NextResponse.json({
    ok: true,
    network: resolveNetwork(),
    policy,
    hardCaps: HARD_CAPS,
    spentUsdToday,
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "guardrails-approve");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const parsed = approveBodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Validation failed");

  const proposal = await getProposal(parsed.data.proposalId);
  if (!proposal) return jsonError(404, "Proposal not found");

  const guard = await evaluateProposal(proposal);
  if (guard.decision !== "PASS") {
    return NextResponse.json(
      { ok: false, error: "Cannot approve a BLOCKed proposal", guard },
      { status: 403 },
    );
  }

  await markApproved(proposal.id);
  return NextResponse.json({
    ok: true,
    approved: true,
    proposalId: proposal.id,
    guard,
    note: "Approved for dry-quote only. Signing still requires the user's wallet. No private keys on server.",
  });
}
