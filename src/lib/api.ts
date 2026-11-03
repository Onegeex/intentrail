import { NextResponse } from "next/server";
import { checkRateLimit, checkWalletRateLimit, getClientIp } from "./rate-limit";

/** Client-safe errors only. Never pass err.message / stack / paths here. */
export function jsonError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) {
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

export function enforceWalletRateLimit(wallet: string, route: string) {
  const result = checkWalletRateLimit(wallet, route);
  if (!result.ok) {
    return jsonError(429, "Wallet rate limit exceeded", {
      retryAfterSec: result.retryAfterSec,
    });
  }
  return null;
}

/** Log server-side; return a generic client message. */
export function internalError(logLabel: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[intentrail] ${logLabel}:`, detail);
  return jsonError(500, "Internal server error");
}
