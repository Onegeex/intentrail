import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api";
import { isVaultConfigured } from "@/lib/vault";
import { runAgentTrade } from "@/lib/vault-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let lastAt = 0;
const bodySchema = z.object({ size: z.enum(["small", "large"]).default("small") });

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "vault-run");
  if (limited) return limited;
  if (!isVaultConfigured()) return NextResponse.json({ ok: false, error: "The vault isn't configured on this deployment." }, { status: 503 });
  const wait = 12_000 - (Date.now() - lastAt);
  if (wait > 0) {
    return NextResponse.json({ ok: false, error: `The agent just traded. Try again in ${Math.ceil(wait / 1000)} seconds.` }, { status: 429 });
  }
  lastAt = Date.now();
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  try {
    const run = await runAgentTrade(body.success ? body.data.size : "small");
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    console.error("[intentrail] vault run", msg);
    return NextResponse.json({ ok: false, error: msg.includes("live NEAR price") ? msg : "The trade couldn't be sent to NEAR testnet." }, { status: 502 });
  }
}
