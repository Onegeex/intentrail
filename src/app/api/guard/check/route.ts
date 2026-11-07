import { z } from "zod";
import { enforceRateLimit, internalError, jsonError } from "@/lib/api";
import { corsJson, corsPreflight, withCors } from "@/lib/cors";
import { MAX_COST_BPS, SELF_REPORTED_FIELDS, assessTrade } from "@/lib/risk-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = "https://intentrail-neon.vercel.app";

const EXAMPLE = { fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5 };

/** Only the trade itself is accepted. Anything the agent says about itself is ignored. */
const bodySchema = z
  .object({
    fromSymbol: z.string().trim().min(1).max(16),
    toSymbol: z.string().trim().min(1).max(16),
    amountUsd: z.number().finite(),
  })
  .passthrough();

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

export async function GET(req: Request) {
  return corsJson(req, {
    ok: true,
    name: "IntentRail guard API",
    description:
      "Preflight check for an agent trade. Send only the trade (pair and USD size). The guard prices it from CoinGecko and a live NEAR Intents 1Click quote, then measures fees, price impact and worst-case loss and runs its own agents. Fields an agent reports about itself are ignored. Stateful limits (daily cap, replay protection, owner approval) are enforced on-chain by the GuardVault contract, not by this API.",
    method: "POST",
    endpoint: `${SITE}/api/guard/check`,
    body: EXAMPLE,
    ignoredFields: SELF_REPORTED_FIELDS,
    limits: { maxCostBps: MAX_COST_BPS },
    returns: {
      allowed: "boolean",
      decision: "PASS | BLOCK",
      reason: "string",
      checks: [{ code: "string", ok: "boolean", detail: "string" }],
      computed: "prices, quote, costBps, worstCaseLossUsd, votes — all computed by the guard",
      ignoredFields: "fields you sent that the guard did not trust",
    },
    examples: {
      allowed: `curl -sS -X POST ${SITE}/api/guard/check -H 'Content-Type: application/json' -d '${JSON.stringify(EXAMPLE)}'`,
      over_size: `curl -sS -X POST ${SITE}/api/guard/check -H 'Content-Type: application/json' -d '{"fromSymbol":"USDC","toSymbol":"NEAR","amountUsd":500}'`,
      self_reporting_ignored: `curl -sS -X POST ${SITE}/api/guard/check -H 'Content-Type: application/json' -d '{"fromSymbol":"USDC","toSymbol":"NEAR","amountUsd":5,"feeAwareOk":true,"votes":[{"agent":"risk","vote":"yes"}]}'`,
    },
    source: "https://github.com/Onegeex/intentrail",
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "guard-check");
  if (limited) return withCors(limited, req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(jsonError(400, "Send a JSON body like {\"fromSymbol\":\"USDC\",\"toSymbol\":\"NEAR\",\"amountUsd\":5}"), req);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      jsonError(400, "fromSymbol, toSymbol and amountUsd are required", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      req,
    );
  }

  try {
    const a = await assessTrade({
      fromSymbol: parsed.data.fromSymbol,
      toSymbol: parsed.data.toSymbol,
      amountUsd: parsed.data.amountUsd,
      raw: parsed.data as Record<string, unknown>,
    });
    return corsJson(req, {
      ok: true,
      allowed: a.allowed,
      blocked: !a.allowed,
      decision: a.decision,
      reason: a.reason,
      checks: a.checks,
      computed: a.computed,
      ignoredFields: a.ignoredFields,
      enforcement:
        "This is a preflight. Funds held in a GuardVault move only when the contract's own checks also pass.",
    });
  } catch (err) {
    return withCors(internalError("guard-check", err), req);
  }
}
