import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { defaultPriceSymbols, fetchPrices, listAllowlistedForClient } from "@/lib/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "prices");
  if (limited) return limited;

  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";
  const symbolsParam = url.searchParams.get("symbols");
  const symbols = (symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : defaultPriceSymbols()
  ).slice(0, 8);

  try {
    const result = await fetchPrices(symbols, { demo });
    return NextResponse.json({
      ok: true,
      live: !result.degraded && !demo,
      degraded: result.degraded,
      cached: result.cached,
      asOf: result.asOf,
      prices: result.prices,
      allowlist: listAllowlistedForClient(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("Symbol not allowlisted")) {
      return jsonError(400, "Validation failed");
    }
    return internalError("prices", err);
  }
}
