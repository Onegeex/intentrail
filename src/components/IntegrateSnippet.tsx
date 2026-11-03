"use client";

import Link from "next/link";

export function IntegrateSnippet() {
  const snippet = `const res = await fetch("https://intentrail-neon.vercel.app/api/guard/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5,
    slippageBps: 50, stopLossPct: 2, feeAwareOk: true,
    votes: [
      { agent: "trend", vote: "yes", reason: "up" },
      { agent: "risk", vote: "yes", reason: "sized" },
    ],
  }),
});
const { allowed, decision, reason } = await res.json();`;

  return (
    <section className="rounded-2xl border border-violet-900/50 bg-violet-950/20 p-4 sm:p-5 space-y-3 overflow-hidden">
      <h2 className="text-base font-semibold text-white">
        Seatbelt API — ~5 lines
      </h2>
      <p className="text-sm text-zinc-400">
        Drop <code className="text-violet-300">POST /api/guard/check</code> in front of any
        agent that touches money. Fail-closed. CORS enabled for external callers.
      </p>
      <pre className="overflow-x-auto rounded-xl bg-black/60 border border-zinc-800 p-3 text-[10px] sm:text-[11px] leading-relaxed text-zinc-300 font-mono whitespace-pre">
        {snippet}
      </pre>
      <Link
        href="/security"
        className="inline-flex min-h-11 items-center text-sm font-medium text-violet-300 hover:text-violet-200"
      >
        Open playground + curl →
      </Link>
    </section>
  );
}
