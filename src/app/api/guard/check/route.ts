import { randomUUID } from "crypto";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { resolveNetwork } from "@/lib/config";
import { corsJson, corsPreflight, withCors } from "@/lib/cors";
import { checkProposal } from "@/lib/guardrails";
import type { TradeProposal } from "@/lib/types";
import { guardCheckBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXAMPLE_SAFE = {
  fromSymbol: "USDC",
  toSymbol: "NEAR",
  amountUsd: 5,
  slippageBps: 50,
  stopLossPct: 2,
  feeAwareOk: true,
  votes: [
    { agent: "trend" as const, vote: "yes" as const, reason: "uptrend" },
    { agent: "risk" as const, vote: "yes" as const, reason: "sized" },
  ],
};

const CURL_SAFE = `curl -sS -X POST https://intentrail-neon.vercel.app/api/guard/check \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(EXAMPLE_SAFE)}'`;

const CURL_OVERCAP = `curl -sS -X POST https://intentrail-neon.vercel.app/api/guard/check \\
  -H 'Content-Type: application/json' \\
  -d '{"fromSymbol":"USDC","toSymbol":"NEAR","amountUsd":500,"slippageBps":50,"feeAwareOk":true}'`;

const CURL_BAD_TOKEN = `curl -sS -X POST https://intentrail-neon.vercel.app/api/guard/check \\
  -H 'Content-Type: application/json' \\
  -d '{"fromSymbol":"USDC","toSymbol":"DOGE","amountUsd":5}'`;

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

/** Usage doc for humans + agents. */
export async function GET(req: Request) {
  return corsJson(req, {
    ok: true,
    name: "IntentRail seatbelt API",
    description:
      "Fail-closed guardrail check. POST a proposal-like JSON body; receive allowed/blocked + reasons. CORS enabled for browser callers.",
    method: "POST",
    endpoint: "https://intentrail-neon.vercel.app/api/guard/check",
    body: EXAMPLE_SAFE,
    returns: {
      ok: true,
      allowed: "boolean (true when decision===PASS)",
      decision: "PASS | BLOCK",
      reason: "string",
      checks: [{ code: "string", ok: "boolean", detail: "string" }],
    },
    examples: {
      safe_allowed: CURL_SAFE,
      over_cap_blocked: CURL_OVERCAP,
      bad_token_blocked: CURL_BAD_TOKEN,
    },
    snippet:
      'const r = await fetch("https://intentrail-neon.vercel.app/api/guard/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(proposal)}); const { allowed, decision, reason, checks } = await r.json();',
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "guard-check");
  if (limited) return withCors(limited, req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(jsonError(400, "Invalid JSON — send application/json body"), req);
  }

  const parsed = guardCheckBodySchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      jsonError(400, "Validation failed", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
      req,
    );
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
    estimatedFeeUsd:
      b.estimatedFeeUsd ?? Number(((b.amountUsd * 20) / 10_000).toFixed(4)),
    slippageBps: b.slippageBps ?? 50,
    stopLossPct: b.stopLossPct ?? 2,
    trend: b.trend || "flat",
    rationale: b.rationale || "External agent proposal",
    feeAwareOk: b.feeAwareOk ?? true,
    network: b.network || resolveNetwork(),
    demo: b.demo ?? true,
    votes: b.votes,
    swarmAgreed:
      b.swarmAgreed ?? (b.votes ? b.votes.every((v) => v.vote === "yes") : true),
  };

  try {
    const guard = await checkProposal(proposal);
    const allowed = guard.decision === "PASS";
    return corsJson(req, {
      ok: true,
      allowed,
      blocked: !allowed,
      decision: guard.decision,
      reason: guard.reason,
      checks: guard.checks,
      proposalId: guard.proposalId,
    });
  } catch (err) {
    return withCors(internalError("guard-check", err), req);
  }
}
