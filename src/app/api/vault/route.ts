import { NextResponse } from "next/server";
import { getVaultSnapshot, isVaultConfigured } from "@/lib/vault";
import { worstCaseIfGuardHacked } from "@/lib/vault-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; data: unknown } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 4_000) {
      const [vault, worstCase] = await Promise.all([getVaultSnapshot(), worstCaseIfGuardHacked().catch(() => null)]);
      cache = { at: Date.now(), data: { vault, worstCase } };
    }
    const d = cache.data as { vault: unknown; worstCase: unknown };
    return NextResponse.json({ ok: true, configured: isVaultConfigured(), vault: d.vault, worstCase: d.worstCase });
  } catch (e) {
    console.error("[intentrail] vault view", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Couldn't read the vault from NEAR testnet. Try again in a moment." }, { status: 502 });
  }
}
