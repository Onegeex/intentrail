"use client";

import { useState } from "react";
import { useToast } from "./Toast";

type PresetId = "safe" | "big" | "unlisted" | "liar";

const PRESETS: Record<PresetId, { label: string; hint: string; body: Record<string, unknown> }> = {
  safe: { label: "$5 USDC to NEAR", hint: "A normal trade", body: { fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5 } },
  big: { label: "$500 USDC to NEAR", hint: "Ten times the size limit", body: { fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 500 } },
  unlisted: { label: "$5 USDC to DOGE", hint: "Token not on the allowlist", body: { fromSymbol: "USDC", toSymbol: "DOGE", amountUsd: 5 } },
  liar: {
    label: "An agent that grades itself",
    hint: "Sends feeAwareOk, a stop-loss and yes votes",
    body: {
      fromSymbol: "USDC",
      toSymbol: "NEAR",
      amountUsd: 45,
      feeAwareOk: true,
      stopLossPct: 0.1,
      votes: [
        { agent: "trend", vote: "yes", reason: "trust me" },
        { agent: "risk", vote: "yes", reason: "trust me" },
      ],
    },
  },
};

type Result = {
  allowed?: boolean;
  decision?: string;
  reason?: string;
  checks?: { code: string; ok: boolean; detail: string }[];
  computed?: { costBps: number | null; worstCaseLossUsd: number | null; quoteSource: string };
  ignoredFields?: string[];
  error?: string;
};

export function SeatbeltPlayground() {
  const { push } = useToast();
  const [busy, setBusy] = useState<PresetId | null>(null);
  const [active, setActive] = useState<PresetId | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(id: PresetId) {
    setBusy(id);
    setActive(id);
    setResult(null);
    try {
      const res = await fetch("/api/guard/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PRESETS[id].body),
      });
      const data = (await res.json()) as Result;
      setResult(data);
      if (!data.decision) push(data.error || "The guard couldn't check that trade.", "err");
    } catch {
      push("Couldn't reach the guard. Check your connection and try again.", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-5 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
      <div>
        <h2 className="font-display text-3xl font-black tracking-wide text-ivory">Try the guard</h2>
        <p className="mt-1 text-sm text-ivory-dim">
          Each button sends a real request to <code className="font-mono text-ivory">POST /api/guard/check</code>.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(id)}
            className={`min-h-16 rounded-2xl border px-4 py-3 text-left disabled:opacity-60 ${
              active === id ? "border-ivory bg-panel" : "border-rule bg-panel hover:border-ivory-dim"
            }`}
          >
            <span className="block font-display text-2xl font-extrabold tracking-wide text-ivory">
              {busy === id ? "Checking…" : PRESETS[id].label}
            </span>
            <span className="block text-sm text-ivory-dim">{PRESETS[id].hint}</span>
          </button>
        ))}
      </div>

      {result?.decision && (
        <div className="space-y-3" aria-live="polite">
          <p className={`font-display text-3xl font-black tracking-wide ${result.allowed ? "text-proceed" : "text-danger"}`}>
            {result.allowed ? "Allowed" : "Blocked"}
          </p>
          {result.ignoredFields && result.ignoredFields.length > 0 && (
            <p className="rounded-xl border border-caution/40 bg-caution/10 px-3 py-2 text-sm text-ivory">
              Ignored what the agent said about itself: <span className="font-mono">{result.ignoredFields.join(", ")}</span>. The
              guard computed those numbers from live data instead.
            </p>
          )}
          <ul className="divide-y divide-rule/60 text-sm">
            {result.checks?.map((c) => (
              <li key={c.code} className="grid grid-cols-[14px_1fr] gap-3 py-2">
                <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${c.ok ? "bg-proceed" : "bg-danger"}`} />
                <span className={c.ok ? "text-ivory" : "text-danger"}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && !result.decision && <p className="text-sm text-caution">{result.error}</p>}

      <pre className="overflow-x-auto rounded-xl border border-rule bg-panel-deep p-3 font-mono text-[11px] text-ivory">
        {`curl -sS -X POST https://intentrail-neon.vercel.app/api/guard/check \\
  -H 'Content-Type: application/json' \\
  -d '{"fromSymbol":"USDC","toSymbol":"NEAR","amountUsd":5}'`}
      </pre>
    </section>
  );
}
