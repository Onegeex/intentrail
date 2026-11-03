import { getRateLimitRpm } from "./config";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(ip: string, route: string): string {
  return `${route}:${ip}`;
}

/**
 * Simple in-memory fixed-window rate limiter.
 * Fail-closed: if we cannot identify a client, treat as limited.
 */
export function checkRateLimit(
  ip: string | null | undefined,
  route: string,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const rpm = getRateLimitRpm();
  const now = Date.now();
  const key = clientKey(ip && ip.length > 0 ? ip : "unknown", route);
  if (!ip) {
    return { ok: false, retryAfterSec: 60 };
  }
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  if (b.count >= rpm) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true };
}

export function getClientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  // Local / demo fallback — still rate-limited under a shared key
  return "local";
}
