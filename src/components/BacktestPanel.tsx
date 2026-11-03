"use client";

import { useCallback, useEffect, useState } from "react";
import type { BacktestResult } from "@/lib/types";

export function BacktestPanel() {
  const [data, setData] = useState<BacktestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/backtest?symbol=NEAR&days=30");
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error || "Backtest failed");
        setData(null);
        return;
      }
      setData(json.backtest);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Agent backtest (NEAR, 30d)</h2>
          <p className="text-xs text-amber-200/90 mt-1 font-medium">
            Backtest, not a guarantee
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="text-xs rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {data && (
        <>
          <p className="text-xs text-zinc-500">{data.disclaimer}</p>
          <p className="text-[10px] font-mono text-zinc-600">
            source={data.source} · points={data.points} · fee={data.feeBpsAssumed}bps assumed
          </p>
          {data.source === "coingecko" ? (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-zinc-500">Trades</dt>
                <dd className="font-mono text-zinc-100">{data.trades}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Win rate</dt>
                <dd className="font-mono text-zinc-100">
                  {data.winRatePct === null ? "n/a" : `${data.winRatePct}%`}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">PnL after fees</dt>
                <dd className="font-mono text-zinc-100">{data.pnlAfterFeesPct}%</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Max drawdown</dt>
                <dd className="font-mono text-zinc-100">{data.maxDrawdownPct}%</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Buy &amp; hold</dt>
                <dd className="font-mono text-zinc-100">{data.buyAndHoldPct}%</dd>
              </div>
              <div>
                <dt className="text-zinc-500">vs B&amp;H</dt>
                <dd className="font-mono text-zinc-100">{data.vsBuyAndHoldPct}%</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-400">
              Historical series unavailable right now — we do not invent numbers.
            </p>
          )}
        </>
      )}
    </section>
  );
}
