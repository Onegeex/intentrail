"use client";

import type { ReactNode } from "react";

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center gap-1 group align-baseline">
      <span className="underline decoration-dotted decoration-zinc-600 underline-offset-2">
        {children}
      </span>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-[10px] text-zinc-400 hover:bg-zinc-800"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-56 rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-[11px] leading-snug text-zinc-300 shadow-xl group-hover:block group-focus-within:block sm:w-64"
      >
        {label}
      </span>
    </span>
  );
}
