import { NextResponse } from "next/server";

const ALLOW_HEADERS = "Content-Type, Accept, Authorization";
const ALLOW_METHODS = "GET, POST, OPTIONS";

/** Public seatbelt API — any Origin may call (no credentials). */
export function corsHeaders(req?: Request): HeadersInit {
  const origin = req?.headers.get("origin") || "*";
  // Reflect request origin when present (required if browsers send credentials later);
  // still safe: this endpoint is read-only check, no cookies used.
  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withCors(res: NextResponse, req?: Request): NextResponse {
  const h = corsHeaders(req);
  for (const [k, v] of Object.entries(h)) {
    res.headers.set(k, v);
  }
  return res;
}

export function corsPreflight(req: Request): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }), req);
}

export function corsJson(
  req: Request,
  data: unknown,
  init?: { status?: number },
): NextResponse {
  return withCors(NextResponse.json(data, { status: init?.status ?? 200 }), req);
}
