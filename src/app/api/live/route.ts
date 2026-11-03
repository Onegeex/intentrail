import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { HARD_CAPS, resolveNetwork } from "@/lib/config";
import { evaluateProposal } from "@/lib/guardrails";
import { defaultPriceSymbols, fetchPrices } from "@/lib/prices";
import { getPolicy, getSpentToday, listRecentProposals, isApproved } from "@/lib/store";
import { buildProposal } from "@/lib/agent";
import { saveProposal } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live home feed: prices + recent proposals with guardrails re-evaluated,
 * plus an auto-generated fresh probe proposal so the feed is never empty.
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "live");
  if (limited) return limited;

  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";
  const autogen = url.searchParams.get("autogen") !== "0";

  try {
    const priceResult = await fetchPrices(defaultPriceSymbols(), { demo });
    const policy = await getPolicy();
    const spentUsdToday = await getSpentToday();

    let recent = await listRecentProposals(8);

    // Keep the live feed fresh for judges: if empty or last > 60s, propose a small probe
    const newest = recent[0];
    const stale =
      !newest || Date.now() - Date.parse(newest.createdAt) > 60_000;
    if (autogen && stale && !policy.killSwitch) {
      const from = priceResult.prices.find((p) => p.symbol === "USDC");
      const to = priceResult.prices.find((p) => p.symbol === "NEAR");
      if (from && to) {
        const proposal = buildProposal({
          fromSymbol: "USDC",
          toSymbol: "NEAR",
          amountUsd: 5,
          fromPrice: from,
          toPrice: to,
          demo,
        });
        await saveProposal(proposal);
        recent = await listRecentProposals(8);
      }
    }

    const feed = await Promise.all(
      recent.map(async (proposal) => {
        const guard = await evaluateProposal(proposal);
        const approved = await isApproved(proposal.id);
        return { proposal, guard, approved };
      }),
    );

    return NextResponse.json({
      ok: true,
      live: !priceResult.degraded && !demo,
      degraded: priceResult.degraded || demo,
      cached: priceResult.cached,
      asOf: priceResult.asOf || new Date().toISOString(),
      network: resolveNetwork(),
      prices: priceResult.prices,
      policy,
      hardCaps: HARD_CAPS,
      spentUsdToday,
      feed,
      refreshHintSec: 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "live feed error";
    return jsonError(500, msg);
  }
}
