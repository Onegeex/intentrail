"use client";

import type { GuardResult, TradeProposal, QuoteResult } from "@/lib/types";

export function ProposalCard({
  proposal,
  guard,
  quote,
  onApprove,
  onQuote,
  busy,
}: {
  proposal: TradeProposal;
  guard: GuardResult;
  quote?: QuoteResult | null;
  onApprove: () => void;
  onQuote: () => void;
  busy?: boolean;
}) {
  const pass = guard.decision === "PASS";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {proposal.side.toUpperCase()} {proposal.fromSymbol} → {proposal.toSymbol}
          </h3>
          <p className="text-sm text-zinc-400 mt-1">{proposal.rationale}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold tracking-wide ${
            pass
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "bg-red-500/20 text-red-300 border border-red-500/40"
          }`}
        >
          {guard.decision}
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-zinc-500">Amount</dt>
          <dd className="font-mono text-zinc-100">${proposal.amountUsd}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Est. fee</dt>
          <dd className="font-mono text-zinc-100">${proposal.estimatedFeeUsd}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Stop-loss</dt>
          <dd className="font-mono text-zinc-100">{proposal.stopLossPct}%</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Slippage</dt>
          <dd className="font-mono text-zinc-100">{proposal.slippageBps} bps</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Trend</dt>
          <dd className="font-mono text-zinc-100">{proposal.trend}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Network</dt>
          <dd className="font-mono text-zinc-100">{proposal.network}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-zinc-500">Proposal id</dt>
          <dd className="font-mono text-xs text-zinc-300 break-all">{proposal.id}</dd>
        </div>
      </dl>

      {(proposal.votes?.length || proposal.signalPayment) && (
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-3 space-y-2">
          {proposal.votes && proposal.votes.length > 0 && (
            <>
              <p className="text-xs text-zinc-400">
                Multi-agent consensus{" "}
                <span className={proposal.swarmAgreed ? "text-emerald-400" : "text-amber-300"}>
                  {proposal.swarmAgreed ? "AGREE" : "NO CONSENSUS"}
                </span>
              </p>
              <ul className="space-y-1">
                {proposal.votes.map((v) => (
                  <li key={v.agent} className="text-xs font-mono flex gap-2">
                    <span className={v.vote === "yes" ? "text-emerald-400" : "text-red-400"}>
                      {v.vote.toUpperCase()}
                    </span>
                    <span className="text-zinc-300">
                      {v.agent}: {v.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {proposal.riskInputs && (
            <p className="text-xs text-zinc-500 font-mono">
              risk inputs: vol {proposal.riskInputs.volatilityPct}% · dd{" "}
              {proposal.riskInputs.drawdownPct}% · size ${proposal.riskInputs.positionUsd}
            </p>
          )}
          {proposal.signalPayment && (
            <p className="text-xs text-zinc-400">
              Agent spend:{" "}
              <span className={proposal.signalPayment.ok ? "text-emerald-300" : "text-amber-300"}>
                {proposal.signalPayment.ok ? "paid" : "blocked"}
              </span>{" "}
              ${proposal.signalPayment.amountUsd.toFixed(2)}
              {proposal.signalPayment.simulated ? " (simulated budget)" : ""} —{" "}
              {proposal.signalPayment.reason}
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl bg-black/40 border border-zinc-800 p-3">
        <p className="text-xs text-zinc-400 mb-2">Guardrail checks</p>
        <ul className="space-y-1">
          {guard.checks.map((c) => (
            <li key={c.code} className="flex gap-2 text-xs font-mono">
              <span className={c.ok ? "text-emerald-400" : "text-red-400"}>
                {c.ok ? "PASS" : "FAIL"}
              </span>
              <span className="text-zinc-300">
                {c.code}: {c.detail}
              </span>
            </li>
          ))}
        </ul>
        {!pass && (
          <p className="mt-2 text-sm text-red-300">Blocked: {guard.reason}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!pass || busy}
          onClick={onApprove}
          className="rounded-lg bg-violet-600 disabled:opacity-40 hover:bg-violet-500 px-4 py-2 text-sm font-medium"
        >
          Approve (human)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onQuote}
          className="rounded-lg bg-sky-700 disabled:opacity-40 hover:bg-sky-600 px-4 py-2 text-sm font-medium"
        >
          Refresh dry-quote
        </button>
      </div>

      {quote && (
        <div
          className={`rounded-xl border p-3 text-sm space-y-2 ${
            quote.simulated
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-emerald-500/30 bg-emerald-500/5"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-zinc-100">
              {quote.ok ? "Dry quote" : "Quote failed"}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                quote.simulated
                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                  : "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
              }`}
            >
              {quote.simulated ? "simulated" : "live 1Click"}
            </span>
            {!quote.executionEnabled && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-zinc-700/50 text-zinc-300 border border-zinc-600">
                execution off
              </span>
            )}
          </div>
          <p className="text-zinc-400 text-xs">{quote.message}</p>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
            <div>
              <dt className="text-zinc-500">amountOut</dt>
              <dd className="text-zinc-200 break-all">
                {quote.amountOutFormatted || quote.amountOut || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">out USD</dt>
              <dd className="text-zinc-200">${quote.amountOutUsd ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">fee</dt>
              <dd className="text-zinc-200">
                ${quote.feeUsd?.toFixed(4) ?? "—"} ({quote.feeBps ?? "—"} bps)
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">slippage</dt>
              <dd className="text-zinc-200">{quote.slippageBps ?? "—"} bps</dd>
            </div>
            <div>
              <dt className="text-zinc-500">deadline</dt>
              <dd className="text-zinc-200 break-all">{quote.deadline || "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">ETA</dt>
              <dd className="text-zinc-200">{quote.timeEstimateSec ?? "—"}s</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
