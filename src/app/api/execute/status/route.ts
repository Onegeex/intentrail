import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, internalError } from "@/lib/api";
import { getSwapStatus } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "execute-status");
  if (limited) return limited;

  const depositAddress = new URL(req.url).searchParams.get("depositAddress") || "";
  if (!depositAddress || depositAddress.length > 128) {
    return jsonError(400, "depositAddress required");
  }

  try {
    const status = await getSwapStatus(depositAddress);
    return NextResponse.json(status);
  } catch (err) {
    return internalError("execute-status", err);
  }
}
