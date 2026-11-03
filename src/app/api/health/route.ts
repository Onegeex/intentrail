import { NextResponse } from "next/server";
import { resolveNetwork, isMainnetLiveAllowed } from "@/lib/config";
import { getPolicy } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const policy = await getPolicy();
  return NextResponse.json({
    ok: true,
    name: "IntentRail",
    network: resolveNetwork(),
    mainnetLiveAllowed: isMainnetLiveAllowed(),
    killSwitch: policy.killSwitch,
    time: new Date().toISOString(),
  });
}
