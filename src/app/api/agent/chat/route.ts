import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api";
import { listModels, llmConfigured, runLlmAgent } from "@/lib/llm-agent";
import { isVaultConfigured } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

let lastAt = 0;
const bodySchema = z.object({
  message: z.string().trim().min(1).max(600),
  hijacked: z.boolean().default(false),
});

export async function GET(req: Request) {
  const wantModels = new URL(req.url).searchParams.has("models");
  const models = wantModels && llmConfigured() ? await listModels().catch((e) => [String(e.message ?? e)]) : undefined;
  return NextResponse.json({ ok: true, configured: llmConfigured() && isVaultConfigured(), models });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "agent-chat");
  if (limited) return limited;
  if (!llmConfigured()) {
    return NextResponse.json({ ok: false, needsKey: true, error: "The language model isn't connected on this deployment yet." }, { status: 503 });
  }
  const wait = 10_000 - (Date.now() - lastAt);
  if (wait > 0) {
    return NextResponse.json({ ok: false, error: `The agent is busy. Try again in ${Math.ceil(wait / 1000)} seconds.` }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Write a message of up to 600 characters." }, { status: 400 });
  lastAt = Date.now();
  try {
    const out = await runLlmAgent(parsed.data.message, parsed.data.hijacked);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    console.error("[intentrail] llm agent", msg);
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 502 });
  }
}
