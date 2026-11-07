"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Signal box" },
  { href: "/demo", label: "Demo" },
  { href: "/security", label: "Seatbelt API" },
];

function Mark() {
  // Two rails and a lit signal lamp.
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true">
      <path d="M1 6h18M1 13h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="22" cy="9.5" r="3.4" fill="var(--color-proceed)" />
    </svg>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-50 border-b border-rule bg-panel/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-wide text-ivory"
        >
          <Mark />
          IntentRail
        </Link>
        <div className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`min-h-10 inline-flex items-center rounded-full px-4 text-sm transition-colors ${
                  active
                    ? "bg-ivory text-panel font-semibold"
                    : "text-ivory-dim hover:text-ivory"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-rule text-ivory sm:hidden"
          aria-expanded={open}
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && (
        <div className="border-t border-rule px-4 py-3 sm:hidden space-y-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block min-h-11 rounded-lg px-3 py-3 text-base text-ivory hover:bg-panel-raised"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
