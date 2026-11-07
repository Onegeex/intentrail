import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api";
import { LOW_BUDGET_NEAR, agentBudgetNear, getVaultSnapshot, isVaultConfigured } from "@/lib/vault";
import { runAttackSuite } from "@/lib/vault-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The suite costs gas from the agent key's allowance, so one live run every 90 seconds. */
let last: { at: number; data: Awaited<ReturnType<typeof runAttackSuite>> } | null = null;
let running: Promise<Awaited<ReturnType<typeof runAttackSuite>>> | null = null;

export async function GET() {
  return NextResponse.json({ ok: true, last: last ? { ranAt: new Date(last.at).toISOString(), ...last.data } : null });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "vault-attack");
  if (limited) return limited;
  if (!isVaultConfigured()) return NextResponse.json({ ok: false, error: "The vault isn't configured on this deployment." }, { status: 503 });
  if (last && Date.now() - last.at < 90_000) {
    return NextResponse.json({ ok: true, cached: true, ranAt: new Date(last.at).toISOString(), ...last.data });
  }
  const snap = await getVaultSnapshot().catch(() => null);
  if (snap && agentBudgetNear(snap) < LOW_BUDGET_NEAR) {
    return NextResponse.json(
      { ok: false, lowBudget: true, error: "The agent's gas budget is nearly used up, so live runs are paused until the owner refreshes it. The recorded run below is real." },
      { status: 503 },
    );
  }
  try {
    running ??= runAttackSuite();
    const data = await running;
    last = { at: Date.now(), data };
    return NextResponse.json({ ok: true, cached: false, ranAt: new Date(last.at).toISOString(), ...data });
  } catch (e) {
    console.error("[intentrail] attack suite", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "The attempts couldn't reach NEAR testnet. Try again shortly." }, { status: 502 });
  } finally {
    running = null;
  }
}
