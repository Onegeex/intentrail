"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuardResult, PriceSnapshot, TradeProposal } from "@/lib/types";

type FeedItem = {
  proposal: TradeProposal;
  guard: GuardResult;
  approved: boolean;
};

type LivePayload = {
  ok: boolean;
  live: boolean;
  degraded: boolean;
  cached: boolean;
  asOf: string;
  network: string;
  prices: PriceSnapshot[];
  policy: {
    killSwitch: boolean;
    maxLossPerTradeUsd: number;
    dailySpendCapUsd: number;
    maxSlippageBps: number;
    requireHumanApproval: boolean;
    allowlistedSymbols: string[];
  };
  spentUsdToday: number;
  feed: FeedItem[];
  refreshHintSec: number;
  error?: string;
};

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function LiveDashboard() {
  const [data, setData] = useState<LivePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/live?t=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json()) as LivePayload;
      if (!res.ok || !json.ok) {
        setErr(json.error || "Live feed unavailable");
        return;
      }
      setData(json);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const live = Boolean(data?.live);
  const asOf = data?.asOf;

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900/90 to-zinc-900/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                live ? "bg-emerald-400 animate-ping" : "bg-amber-400"
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                live ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              {live ? "Live" : data?.degraded ? "Degraded · fallback prices" : "Connecting…"}
            </p>
            <p className="text-[11px] text-zinc-500">
              Network <span className="font-mono text-zinc-300">{data?.network || "…"}</span>
              {asOf && (
                <>
                  {" · "}Updated {formatTime(asOf)}
                  {data?.cached ? " (cache)" : ""}
                </>
              )}
              {" · "}auto-refresh 15s
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Refresh now
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Feed issue: {err}. Showing last good data if available.
        </div>
      )}

      {/* Price strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(data?.prices || []).map((p) => {
          const up = p.change24hPct >= 0;
          return (
            <div
              key={p.symbol}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium tracking-wide text-zinc-400">
                  {p.symbol}
                </span>
                <span
                  className={`text-[11px] font-mono ${
                    up ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {up ? "+" : ""}
                  {p.change24hPct.toFixed(2)}%
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-white font-mono">
                ${formatPrice(p.priceUsd)}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">
                {p.source}
              </p>
            </div>
          );
        })}
        {!data &&
          ["NEAR", "USDC", "BTC", "ETH"].map((s) => (
            <div
              key={s}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 animate-pulse h-[96px]"
            />
          ))}
      </div>

      {/* Guardrail status */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold text-white tracking-wide">
            Guardrail status
          </h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              data?.policy.killSwitch
                ? "bg-red-500/20 text-red-300 border border-red-500/40"
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            }`}
          >
            {data?.policy.killSwitch ? "KILL SWITCH ON" : "KILL SWITCH OFF"}
          </span>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-black/35 px-3 py-3">
            <p className="text-zinc-500 text-xs">Daily cap used</p>
            <p className="font-mono text-zinc-100 mt-1">
              ${(data?.spentUsdToday ?? 0).toFixed(2)}
              <span className="text-zinc-500">
                {" "}
                / ${data?.policy.dailySpendCapUsd ?? "—"}
              </span>
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-violet-500"
                style={{
                  width: `${Math.min(
                    100,
                    ((data?.spentUsdToday ?? 0) /
                      Math.max(1, data?.policy.dailySpendCapUsd ?? 25)) *
                      100,
                  )}%`,
                }}
              />
            </div>
          </div>
          <div className="rounded-xl bg-black/35 px-3 py-3">
            <p className="text-zinc-500 text-xs">Max loss / trade</p>
            <p className="font-mono text-zinc-100 mt-1">
              ${data?.policy.maxLossPerTradeUsd ?? "—"}
            </p>
          </div>
          <div className="rounded-xl bg-black/35 px-3 py-3">
            <p className="text-zinc-500 text-xs">Human approval</p>
            <p className="font-mono text-emerald-300 mt-1">
              {data?.policy.requireHumanApproval !== false
                ? "required"
                : "optional"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          Allowlist:{" "}
          <span className="font-mono text-zinc-400">
            {(data?.policy.allowlistedSymbols || []).join(", ") || "…"}
          </span>
          {" · "}tick #{tick}
        </p>
      </section>

      {/* Agent feed */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Live agent feed</h2>
          <span className="text-[11px] text-zinc-500">
            PASS/BLOCK recomputed each refresh
          </span>
        </div>
        <ul className="divide-y divide-zinc-800/80">
          {(data?.feed || []).length === 0 && (
            <li className="px-5 py-8 text-sm text-zinc-500 text-center">
              Waiting for first proposal…
            </li>
          )}
          {(data?.feed || []).map(({ proposal, guard, approved }) => {
            const pass = guard.decision === "PASS";
            return (
              <li key={proposal.id} className="px-5 py-4 hover:bg-white/[0.02]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">
                      {proposal.side.toUpperCase()} {proposal.fromSymbol} →{" "}
                      {proposal.toSymbol}{" "}
                      <span className="font-mono text-zinc-400">
                        ${proposal.amountUsd}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-500 mt-1 max-w-xl">
                      {proposal.rationale}
                    </p>
                    <p className="text-[10px] font-mono text-zinc-600 mt-1">
                      {formatTime(proposal.createdAt)} · stop {proposal.stopLossPct}% ·
                      slip {proposal.slippageBps}bps
                      {approved ? " · approved" : ""}
                      {proposal.swarmAgreed === true
                        ? " · swarm✓"
                        : proposal.votes
                          ? " · swarm✗"
                          : ""}
                      {proposal.signalPayment
                        ? proposal.signalPayment.ok
                          ? " · signal$"
                          : " · signal✗"
                        : ""}
                    </p>
                    {proposal.votes && proposal.votes.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {proposal.votes.map((v) => (
                          <span
                            key={v.agent}
                            title={v.reason}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-mono border ${
                              v.vote === "yes"
                                ? "border-emerald-800 text-emerald-400"
                                : "border-red-900 text-red-400"
                            }`}
                          >
                            {v.agent}:{v.vote}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      pass
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-red-500/15 text-red-300 border border-red-500/30"
                    }`}
                  >
                    {guard.decision}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {guard.checks.map((c) => (
                    <span
                      key={c.code}
                      title={c.detail}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono border ${
                        c.ok
                          ? "border-emerald-900/60 text-emerald-500/90"
                          : "border-red-900/60 text-red-400"
                      }`}
                    >
                      {c.code}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
