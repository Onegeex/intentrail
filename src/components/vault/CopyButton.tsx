"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-rule px-3 text-xs text-ivory hover:border-ivory-dim"
    >
      {done ? "Copied" : label}
    </button>
  );
}
