import { randomUUID } from "crypto";
import { HARD_CAPS } from "./config";
import { requestDryQuote } from "./intents";
import { fetchPrices } from "./prices";
import { getPolicy } from "./store";
import { estimateVolatilityPct } from "./swarm";
import { getTokenBySymbol, isAllowlistedSymbol } from "./tokens";
import type { GuardCheck, TradeProposal } from "./types";

/**
 * The guard's own assessment of a trade. Nothing here comes from the agent
 * except the trade it wants (pair and size). Fees, price impact and
 * worst-case loss are computed server-side from live data. The guard has no
 * trading strategy: it doesn't judge whether a trade is a good idea, only
 * whether it's safe.
 * If live data is missing, the trade is blocked.
 */

/** Fields agents sometimes send about themselves. We ignore them, and say so. */
export const SELF_REPORTED_FIELDS = [
  "feeAwareOk",
  "stopLossPct",
  "votes",
  "swarmAgreed",
  "slippageBps",
  "estimatedFeeUsd",
  "estimatedOut",
  "trend",
] as const;

export const MAX_COST_BPS = 100;

export type Assessment = {
  allowed: boolean;
  decision: "PASS" | "BLOCK";
  reason: string;
  checks: GuardCheck[];
  computed: {
    priceInUsd: number | null;
    priceOutUsd: number | null;
    quoteSource: "1click-live" | "unavailable";
    amountOut: string | null;
    costBps: number | null;
    costUsd: number | null;
    volatilityPct: number | null;
    worstCaseLossUsd: number | null;
  };
  ignoredFields: string[];
};

export async function assessTrade(input: {
  fromSymbol: string;
  toSymbol: string;
  amountUsd: number;
  raw?: Record<string, unknown>;
}): Promise<Assessment> {
  const checks: GuardCheck[] = [];
  const push = (code: string, ok: boolean, detail: string) => checks.push({ code, ok, detail });
  const from = input.fromSymbol.toUpperCase();
  const to = input.toSymbol.toUpperCase();
  const amountUsd = input.amountUsd;
  const ignoredFields = SELF_REPORTED_FIELDS.filter((f) => input.raw && f in input.raw);
  const policy = await getPolicy();

  const computed: Assessment["computed"] = {
    priceInUsd: null,
    priceOutUsd: null,
    quoteSource: "unavailable",
    amountOut: null,
    costBps: null,
    costUsd: null,
    volatilityPct: null,
    worstCaseLossUsd: null,
  };

  push("KILL_SWITCH", !policy.killSwitch, policy.killSwitch ? "The operator has stopped all trading." : "Trading is on.");

  const listed = isAllowlistedSymbol(from) && isAllowlistedSymbol(to);
  push(
    "ALLOWLIST",
    listed,
    listed ? `${from} and ${to} are both allowlisted.` : `${isAllowlistedSymbol(from) ? to : from} isn't on the allowlist.`,
  );
  push("PAIR", from !== to, from !== to ? "Different tokens in and out." : "From and to are the same token.");

  const sizeOk =
    Number.isFinite(amountUsd) && amountUsd >= HARD_CAPS.minTradeUsd && amountUsd <= HARD_CAPS.maxTradeUsd;
  push(
    "SIZE",
    sizeOk,
    sizeOk
      ? `$${amountUsd} is within $${HARD_CAPS.minTradeUsd}–$${HARD_CAPS.maxTradeUsd}.`
      : `$${amountUsd} is outside the $${HARD_CAPS.minTradeUsd}–$${HARD_CAPS.maxTradeUsd} range.`,
  );

  if (listed && from !== to) {
    // Live prices. Fallback prices don't count: fail closed.
    const { prices, degraded } = await fetchPrices([from, to]);
    const pIn = prices.find((p) => p.symbol === from)!;
    const pOut = prices.find((p) => p.symbol === to)!;
    const livePrices = !degraded && pIn.source === "coingecko" && pOut.source === "coingecko";
    push(
      "LIVE_PRICE",
      livePrices,
      livePrices
        ? `${from} $${pIn.priceUsd}, ${to} $${pOut.priceUsd} from CoinGecko.`
        : "Couldn't get live prices, so the guard won't price this trade.",
    );
    computed.priceInUsd = pIn.priceUsd;
    computed.priceOutUsd = pOut.priceUsd;

    if (livePrices && sizeOk) {
      // A real NEAR Intents quote for exactly this trade.
      const fromTok = getTokenBySymbol(from)!;
      const units = amountUsd / pIn.priceUsd;
      const amountIn =
        fromTok.decimals <= 8
          ? String(Math.max(1, Math.round(units * 10 ** fromTok.decimals)))
          : `${Math.max(1, Math.floor(units * 1e8))}${"0".repeat(fromTok.decimals - 8)}`;
      const probe: TradeProposal = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        side: "buy",
        fromSymbol: from,
        toSymbol: to,
        amountUsd,
        amountIn,
        estimatedOut: "0",
        estimatedFeeUsd: 0,
        slippageBps: policy.maxSlippageBps,
        stopLossPct: 0,
        trend: "flat",
        rationale: "guard probe",
        feeAwareOk: false,
        network: "mainnet",
        demo: false,
      };
      const q = await requestDryQuote(probe);
      const live = q.ok && !q.simulated && typeof q.feeBps === "number";
      push(
        "LIVE_QUOTE",
        live,
        live
          ? `NEAR Intents 1Click quoted ${q.amountOutFormatted ?? q.amountOut} ${to}.`
          : "No live NEAR Intents quote, so fees and price impact can't be measured.",
      );
      if (live) {
        computed.quoteSource = "1click-live";
        computed.amountOut = q.amountOutFormatted ?? q.amountOut ?? null;
        computed.costBps = q.feeBps!;
        computed.costUsd = q.feeUsd ?? null;
        const costOk = q.feeBps! <= MAX_COST_BPS;
        push(
          "COST",
          costOk,
          `Fees and price impact from the quote: ${q.feeBps} bps ($${(q.feeUsd ?? 0).toFixed(4)}). Limit ${MAX_COST_BPS} bps.`,
        );

        const vol = estimateVolatilityPct(pOut.change24hPct);
        computed.volatilityPct = Number(vol.toFixed(2));
        const worst = amountUsd * (q.feeBps! / 10_000 + vol / 100);
        computed.worstCaseLossUsd = Number(worst.toFixed(4));
        const lossOk = worst <= policy.maxLossPerTradeUsd + 1e-9;
        push(
          "MAX_LOSS",
          lossOk,
          `Worst case: cost plus a one-day move of ${vol.toFixed(1)}% is $${worst.toFixed(2)}. Limit $${policy.maxLossPerTradeUsd}.`,
        );

      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    allowed: failed.length === 0,
    decision: failed.length === 0 ? "PASS" : "BLOCK",
    reason: failed.length === 0 ? "Every check passed." : failed.map((f) => `${f.code}: ${f.detail}`).join(" "),
    checks,
    computed,
    ignoredFields,
  };
}
