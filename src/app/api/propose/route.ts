import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { buildProposal } from "@/lib/agent";
import { buyPremiumSignal } from "@/lib/economy";
import { evaluateProposal } from "@/lib/guardrails";
import { requestDryQuote } from "@/lib/intents";
import { optionalNearAiReason } from "@/lib/near-ai";
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

    const signalPayment = await buyPremiumSignal();

    const proposal = buildProposal({
      fromSymbol,
      toSymbol,
      amountUsd,
      fromPrice,
      toPrice,
      demo,
    });
    proposal.signalPayment = signalPayment;
    if (signalPayment.ok && signalPayment.premiumHint) {
      proposal.rationale = `${proposal.rationale} ${signalPayment.premiumHint}`;
    }

    // Optional NEAR AI enrichment (env-flagged; never required)
    const ai = await optionalNearAiReason(
      `Trend vote and risk for ${fromSymbol}->${toSymbol} $${amountUsd}: ${proposal.rationale}`,
    );
    if (ai && proposal.votes?.[0]) {
      proposal.votes[0] = {
        ...proposal.votes[0],
        reason: `${proposal.votes[0].reason} (NEAR AI: ${ai})`,
      };
    }

    await saveProposal(proposal);

    const quote = await requestDryQuote(proposal);
    const guard = await evaluateProposal(proposal, quote);

    return NextResponse.json({
      ok: true,
      proposal,
      guard,
      quote,
      prices: { from: fromPrice, to: toPrice },
    });
  } catch (err) {
    return internalError("propose", err);
  }
}
