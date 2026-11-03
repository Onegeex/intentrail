"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "Try demo" },
  { href: "/security", label: "Security & seatbelt" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[#07090f]/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white">
          IntentRail
        </Link>
        <div className="hidden items-center gap-4 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="min-h-10 inline-flex items-center text-sm text-zinc-300 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-zinc-700 text-zinc-200 sm:hidden"
          aria-expanded={open}
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && (
        <div className="border-t border-zinc-800 px-4 py-3 sm:hidden space-y-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block min-h-11 rounded-lg px-3 py-3 text-base text-zinc-200 hover:bg-zinc-900"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
