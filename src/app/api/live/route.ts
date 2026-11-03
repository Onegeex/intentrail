import { NextResponse } from "next/server";
import { enforceRateLimit, internalError } from "@/lib/api";
import { HARD_CAPS, isMainnetLiveAllowed, resolveNetwork } from "@/lib/config";
import { evaluateProposal } from "@/lib/guardrails";
import { defaultPriceSymbols, fetchPrices } from "@/lib/prices";
import {
  getPolicy,
  getSpentToday,
  getSignalSpentToday,
  listRecentProposals,
  isApproved,
  saveProposal,
} from "@/lib/store";
import { buildProposal } from "@/lib/agent";
import type { GuardResult, TradeProposal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live home feed: prices + recent proposals with guardrails re-evaluated,
 * plus an auto-generated fresh probe proposal so the feed is never empty.
 * Must keep returning prices even if proposal persistence is degraded.
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "live");
  if (limited) return limited;

  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";
  const autogen = url.searchParams.get("autogen") !== "0";

  try {
    const priceResult = await fetchPrices(defaultPriceSymbols(), { demo });

    let policy;
    let spentUsdToday = 0;
    let signalSpentUsdToday = 0;
    let recent: TradeProposal[] = [];
    try {
      policy = await getPolicy();
      spentUsdToday = await getSpentToday();
      signalSpentUsdToday = await getSignalSpentToday();
      recent = await listRecentProposals(8);
    } catch (err) {
      console.error("[intentrail] live state load:", err instanceof Error ? err.message : err);
      policy = {
        ...({
          maxLossPerTradeUsd: 2,
          dailySpendCapUsd: 25,
          maxSlippageBps: 100,
          requireHumanApproval: true,
          allowlistedSymbols: ["NEAR", "USDC", "WETH", "ETH", "BTC"],
        } as const),
        killSwitch: true,
      };
    }

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
        try {
          await saveProposal(proposal);
          recent = await listRecentProposals(8);
        } catch (err) {
          console.error(
            "[intentrail] live saveProposal:",
            err instanceof Error ? err.message : err,
          );
          // Still show the in-request proposal even if persist failed
          recent = [proposal, ...recent].slice(0, 8);
        }
      }
    }

    const feed: {
      proposal: TradeProposal;
      guard: GuardResult;
      approved: boolean;
    }[] = [];
    for (const proposal of recent) {
      try {
        const guard = await evaluateProposal(proposal);
        const approved = await isApproved(proposal.id);
        feed.push({ proposal, guard, approved });
      } catch (err) {
        console.error(
          "[intentrail] live evaluate:",
          err instanceof Error ? err.message : err,
        );
        feed.push({
          proposal,
          guard: {
            decision: "BLOCK",
            reason: "Guardrail evaluation unavailable",
            checks: [
              {
                code: "KILL_SWITCH",
                ok: false,
                detail: "Fail closed: evaluation error",
              },
            ],
            proposalId: proposal.id,
          },
          approved: false,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      live: !priceResult.degraded && !demo,
      degraded: priceResult.degraded || demo,
      cached: priceResult.cached,
      asOf: priceResult.asOf || new Date().toISOString(),
      network: resolveNetwork(),
      mainnetLiveAllowed: isMainnetLiveAllowed(),
      prices: priceResult.prices,
      policy,
      hardCaps: HARD_CAPS,
      spentUsdToday,
      signalSpentUsdToday,
      feed,
      refreshHintSec: 15,
    });
  } catch (err) {
    return internalError("live", err);
  }
}
