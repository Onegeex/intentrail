import { NextResponse } from "next/server";
import { enforceRateLimit, internalError } from "@/lib/api";
import { runBacktest } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "backtest");
  if (limited) return limited;
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") || "NEAR";
    const days = Number(url.searchParams.get("days") || "30");
    const result = await runBacktest({ symbol, days });
    return NextResponse.json({ ok: true, backtest: result });
  } catch (err) {
    return internalError("backtest", err);
  }
}
