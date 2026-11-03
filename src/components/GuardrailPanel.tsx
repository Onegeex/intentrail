"use client";

import { useEffect, useState } from "react";
import { KillSwitch } from "./KillSwitch";

type PolicyView = {
  maxLossPerTradeUsd: number;
  dailySpendCapUsd: number;
  maxSlippageBps: number;
  requireHumanApproval: boolean;
  allowlistedSymbols: string[];
  killSwitch: boolean;
};

export function GuardrailPanel() {
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [spent, setSpent] = useState(0);
  const [hardCaps, setHardCaps] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/guardrails")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setPolicy(d.policy);
          setSpent(d.spentUsdToday);
          setHardCaps(d.hardCaps);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Guardrails</h2>
        <KillSwitch />
      </div>
      {!policy ? (
        <p className="text-sm text-zinc-500">Loading policy…</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          <li className="rounded-lg bg-black/30 px-3 py-2">
            Max loss / trade:{" "}
            <span className="font-mono text-emerald-300">
              ${policy.maxLossPerTradeUsd}
            </span>
          </li>
          <li className="rounded-lg bg-black/30 px-3 py-2">
            Daily spend cap:{" "}
            <span className="font-mono text-emerald-300">
              ${policy.dailySpendCapUsd}
            </span>{" "}
            <span className="text-zinc-500">(used ${spent.toFixed(2)})</span>
          </li>
          <li className="rounded-lg bg-black/30 px-3 py-2">
            Max slippage:{" "}
            <span className="font-mono text-emerald-300">
              {policy.maxSlippageBps} bps
            </span>
          </li>
          <li className="rounded-lg bg-black/30 px-3 py-2">
            Human approval:{" "}
            <span className="font-mono text-emerald-300">
              {policy.requireHumanApproval ? "required" : "optional"}
            </span>
          </li>
          <li className="rounded-lg bg-black/30 px-3 py-2 sm:col-span-2">
            Allowlist:{" "}
            <span className="font-mono text-zinc-200">
              {policy.allowlistedSymbols.join(", ")}
            </span>
          </li>
        </ul>
      )}
      {hardCaps && (
        <p className="text-[11px] text-zinc-500">
          Hard caps (server): max trade ${hardCaps.maxTradeUsd}, max loss $
          {hardCaps.maxLossPerTradeUsd}, daily ${hardCaps.dailySpendCapUsd},
          slippage {hardCaps.maxSlippageBps} bps. Env can only tighten these.
        </p>
      )}
    </section>
  );
}
