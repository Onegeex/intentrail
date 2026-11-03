import { getRateLimitRpm } from "./config";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function bump(key: string, limit: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true };
}

/**
 * Simple in-memory fixed-window rate limiter (IP and optional wallet).
 * Fail-closed: if we cannot identify a client IP, treat as limited.
 */
export function checkRateLimit(
  ip: string | null | undefined,
  route: string,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const rpm = getRateLimitRpm();
  if (!ip) {
    return { ok: false, retryAfterSec: 60 };
  }
  return bump(`${route}:ip:${ip}`, rpm);
}

export function checkWalletRateLimit(
  wallet: string | null | undefined,
  route: string,
  rpm = 10,
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (!wallet || wallet.length < 2) {
    return { ok: false, retryAfterSec: 60 };
  }
  return bump(`${route}:wallet:${wallet.toLowerCase()}`, rpm);
}

export function getClientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  return "local";
}
