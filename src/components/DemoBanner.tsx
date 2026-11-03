"use client";

import Link from "next/link";

export function DemoBanner() {
  return (
    <div className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-100 text-sm px-4 py-2 text-center">
      <strong>Demo mode</strong> — no wallet required. Prices and proposals are simulated.
      Guardrails still run server-side and fail closed.{" "}
      <Link className="underline hover:text-white" href="/">
        Exit demo
      </Link>
    </div>
  );
}
