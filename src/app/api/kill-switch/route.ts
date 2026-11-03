import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { getPolicy, getState, setKillSwitch } from "@/lib/store";
import { killSwitchBodySchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "kill-get");
  if (limited) return limited;
  const state = await getState();
  const policy = await getPolicy();
  return NextResponse.json({
    ok: true,
    killSwitch: state.killSwitch,
    killReason: state.killReason,
    policy,
    updatedAt: state.updatedAt,
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "kill-set");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const parsed = killSwitchBodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Validation failed");

  const state = await setKillSwitch(parsed.data.enabled, parsed.data.reason);
  return NextResponse.json({
    ok: true,
    killSwitch: state.killSwitch,
    killReason: state.killReason,
    persisted: true,
    updatedAt: state.updatedAt,
  });
}
