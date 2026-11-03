"use client";

import { useState } from "react";
import { ProposalCard } from "./ProposalCard";
import type { GuardResult, QuoteResult, TradeProposal } from "@/lib/types";

export function AgentPanel({ demo = false }: { demo?: boolean }) {
  const [fromSymbol, setFromSymbol] = useState("USDC");
  const [toSymbol, setToSymbol] = useState("NEAR");
  const [amountUsd, setAmountUsd] = useState(5);
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  async function propose() {
    setBusy(true);
    setMsg(null);
    setQuote(null);
    setApproved(false);
    try {
      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromSymbol, toSymbol, amountUsd, demo }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || "Propose failed");
        setProposal(null);
        setGuard(null);
        return;
      }
      setProposal(data.proposal);
      setGuard(data.guard);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!proposal) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id, approved: true }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || "Approve failed");
        if (data.guard) setGuard(data.guard);
        return;
      }
      setApproved(true);
      setMsg("Human approval recorded. You can now request a dry-quote.");
      if (data.guard) setGuard(data.guard);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function dryQuote() {
    if (!proposal) return;
    if (!approved) {
      setMsg("Approve the proposal first (human-in-the-loop).");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id, dry: true }),
      });
      const data = await res.json();
      if (data.guard) setGuard(data.guard);
      if (!data.ok) {
        setMsg(data.error || "Quote failed");
        setQuote(data.quote || null);
        return;
      }
      setQuote(data.quote);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <h2 className="text-base font-semibold text-white">Agent proposal</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-sm text-zinc-400">
            From
            <select
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-zinc-100"
              value={fromSymbol}
              onChange={(e) => setFromSymbol(e.target.value)}
            >
              <option>USDC</option>
              <option>NEAR</option>
              <option>ETH</option>
              <option>BTC</option>
              <option>WETH</option>
            </select>
          </label>
          <label className="text-sm text-zinc-400">
            To
            <select
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-zinc-100"
              value={toSymbol}
              onChange={(e) => setToSymbol(e.target.value)}
            >
              <option>NEAR</option>
              <option>USDC</option>
              <option>ETH</option>
              <option>BTC</option>
              <option>WETH</option>
            </select>
          </label>
          <label className="text-sm text-zinc-400">
            Amount (USD)
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-zinc-100 font-mono"
              value={amountUsd}
              onChange={(e) => setAmountUsd(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={propose}
          className="rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 px-4 py-2 text-sm font-semibold"
        >
          {busy ? "Working…" : "Propose trade"}
        </button>
        {msg && <p className="text-sm text-amber-200">{msg}</p>}
      </div>

      {proposal && guard && (
        <ProposalCard
          proposal={proposal}
          guard={guard}
          quote={quote}
          onApprove={approve}
          onQuote={dryQuote}
          busy={busy}
        />
      )}
    </section>
  );
}
