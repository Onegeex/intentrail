import { NextResponse } from "next/server";
import { getVaultSnapshot, isVaultConfigured } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; data: unknown } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 4_000) {
      cache = { at: Date.now(), data: await getVaultSnapshot() };
    }
    return NextResponse.json({ ok: true, configured: isVaultConfigured(), vault: cache.data });
  } catch (e) {
    console.error("[intentrail] vault view", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Couldn't read the vault from NEAR testnet. Try again in a moment." }, { status: 502 });
  }
}
