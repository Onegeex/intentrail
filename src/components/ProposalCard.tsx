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
          disabled={!pass || busy}
          onClick={onQuote}
          className="rounded-lg bg-sky-700 disabled:opacity-40 hover:bg-sky-600 px-4 py-2 text-sm font-medium"
        >
          Dry-quote via NEAR Intents
        </button>
      </div>

      {quote && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm">
          <p className="font-medium text-zinc-200 mb-1">
            Quote {quote.ok ? "ok" : "failed"}
            {quote.stub ? " (stub)" : ""}
          </p>
          <p className="text-zinc-400 text-xs">{quote.message}</p>
          {quote.amountOut && (
            <p className="font-mono text-xs text-zinc-300 mt-2">
              out≈{quote.amountOut} · inUsd={quote.amountInUsd} · outUsd=
              {quote.amountOutUsd}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
