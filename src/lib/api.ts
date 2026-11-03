import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "./rate-limit";

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function enforceRateLimit(req: Request, route: string) {
  const ip = getClientIp(req);
  const result = checkRateLimit(ip, route);
  if (!result.ok) {
    return jsonError(429, "Rate limit exceeded", {
      retryAfterSec: result.retryAfterSec,
    });
  }
  return null;
}
