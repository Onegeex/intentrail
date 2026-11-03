"use client";

import { useState } from "react";
import { useToast } from "./Toast";

type PresetId = "safe" | "overcap" | "badtoken";

const PRESETS: Record<
  PresetId,
  { label: string; expect: "allowed" | "blocked"; body: Record<string, unknown> }
> = {
  safe: {
    label: "Safe trade → allowed",
    expect: "allowed",
    body: {
      fromSymbol: "USDC",
      toSymbol: "NEAR",
      amountUsd: 5,
      slippageBps: 50,
      stopLossPct: 2,
      feeAwareOk: true,
      votes: [
        { agent: "trend", vote: "yes", reason: "uptrend" },
        { agent: "risk", vote: "yes", reason: "sized" },
      ],
    },
  },
  overcap: {
    label: "Over-cap → blocked",
    expect: "blocked",
    body: {
      fromSymbol: "USDC",
      toSymbol: "NEAR",
      amountUsd: 500,
      slippageBps: 50,
      feeAwareOk: true,
    },
  },
  badtoken: {
    label: "Bad token → blocked",
    expect: "blocked",
    body: {
      fromSymbol: "USDC",
      toSymbol: "DOGE",
      amountUsd: 5,
    },
  },
};

const CURL = `curl -sS -X POST https://intentrail-neon.vercel.app/api/guard/check \\
  -H 'Content-Type: application/json' \\
  -d '{"fromSymbol":"USDC","toSymbol":"NEAR","amountUsd":5,"slippageBps":50,"stopLossPct":2,"feeAwareOk":true,"votes":[{"agent":"trend","vote":"yes","reason":"uptrend"},{"agent":"risk","vote":"yes","reason":"sized"}]}'`;

export function SeatbeltPlayground() {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<PresetId | null>(null);

  async function run(id: PresetId) {
    setBusy(true);
    setErr(null);
    setActive(id);
    setResult(null);
    try {
      const res = await fetch("/api/guard/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PRESETS[id].body),
      });
      const data = await res.json();
      if (!res.ok && !data.decision) {
        setErr(data.error || `HTTP ${res.status}`);
        push(data.error || "Seatbelt request failed", "err");
        return;
      }
      setResult(data);
      const allowed = Boolean(data.allowed ?? data.decision === "PASS");
      push(
        allowed ? "Seatbelt: ALLOWED" : `Seatbelt: BLOCKED — ${String(data.reason || "").slice(0, 80)}`,
        allowed ? "ok" : "err",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setErr(msg);
      push(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(CURL);
      push("curl copied", "ok");
    } catch {
      push("Could not copy — select the curl below", "info");
    }
  }

  const allowed = result
    ? Boolean(result.allowed ?? result.decision === "PASS")
    : null;

  return (
    <section className="rounded-2xl border border-violet-900/50 bg-violet-950/20 p-4 sm:p-5 space-y-4 overflow-hidden">
      <div>
        <h2 className="text-base font-semibold text-white">Try the seatbelt API</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Same fail-closed engine other agents call via{" "}
          <code className="text-violet-300">POST /api/guard/check</code>. Pick a preset —
          no wallet needed.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => void run(id)}
            className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${
              active === id
                ? "bg-violet-500 text-white"
                : "bg-zinc-900 border border-zinc-700 text-zinc-100 hover:bg-zinc-800"
            }`}
          >
            {busy && active === id ? "Checking…" : PRESETS[id].label}
          </button>
        ))}
      </div>

      {busy && !result && !err && (
        <p className="text-sm text-zinc-400 animate-pulse">Calling seatbelt…</p>
      )}
      {err && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <p
            className={`text-sm font-semibold ${allowed ? "text-emerald-300" : "text-red-300"}`}
          >
            {allowed ? "ALLOWED" : "BLOCKED"}
            {typeof result.decision === "string" ? ` (${result.decision})` : ""}
          </p>
          <p className="text-xs text-zinc-400 break-words">{String(result.reason || "")}</p>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="min-w-full text-left text-xs font-mono">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 pr-3">check</th>
                  <th className="py-1 pr-3">ok</th>
                  <th className="py-1">detail</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(result.checks) &&
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (result.checks as any[]).map((c) => (
                    <tr key={c.code} className="border-t border-zinc-800">
                      <td className="py-1.5 pr-3 text-zinc-300 whitespace-nowrap">{c.code}</td>
                      <td className={`py-1.5 pr-3 ${c.ok ? "text-emerald-400" : "text-red-400"}`}>
                        {c.ok ? "yes" : "no"}
                      </td>
                      <td className="py-1.5 text-zinc-400 max-w-[14rem] sm:max-w-md truncate">
                        {c.detail}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!busy && !result && !err && (
        <p className="text-sm text-zinc-500">No result yet — tap a preset above.</p>
      )}

      <div className="space-y-2 border-t border-violet-900/40 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-zinc-300">Copy-paste curl</p>
          <button
            type="button"
            onClick={() => void copyCurl()}
            className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-900"
          >
            Copy
          </button>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-black/60 border border-zinc-800 p-3 text-[10px] sm:text-[11px] leading-relaxed text-zinc-300 font-mono whitespace-pre">
          {CURL}
        </pre>
      </div>
    </section>
  );
}
