import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { buildProposal } from "@/lib/agent";
import { evaluateProposal } from "@/lib/guardrails";
import { fetchPrices } from "@/lib/prices";
import { saveProposal } from "@/lib/store";
import { proposeBodySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "propose");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const parsed = proposeBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Validation failed", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const { fromSymbol, toSymbol, amountUsd, demo } = parsed.data;

  try {
    const { prices } = await fetchPrices([fromSymbol, toSymbol], { demo });
    const fromPrice = prices.find((p) => p.symbol === fromSymbol.toUpperCase())!;
    const toPrice = prices.find((p) => p.symbol === toSymbol.toUpperCase())!;

    const proposal = buildProposal({
      fromSymbol,
      toSymbol,
      amountUsd,
      fromPrice,
      toPrice,
      demo,
    });

    await saveProposal(proposal);
    const guard = await evaluateProposal(proposal);

    return NextResponse.json({
      ok: true,
      proposal,
      guard,
      prices: { from: fromPrice, to: toPrice },
    });
  } catch (err) {
    return internalError("propose", err);
  }
}
