"use client";

import { useState } from "react";
import { ExecutePanel } from "./ExecutePanel";
import { ProposalCard } from "./ProposalCard";
import type { NearNetwork } from "@/lib/near-wallet";
import type { GuardResult, QuoteResult, TradeProposal } from "@/lib/types";

export function AgentPanel({
  demo = false,
  network = "testnet",
  liveMode = false,
  riskAcknowledged = false,
  mainnetLiveAllowed = true,
}: {
  demo?: boolean;
  network?: NearNetwork;
  liveMode?: boolean;
  riskAcknowledged?: boolean;
  mainnetLiveAllowed?: boolean;
}) {
  const [fromSymbol, setFromSymbol] = useState("USDC");
  const [toSymbol, setToSymbol] = useState("NEAR");
  const [amountUsd, setAmountUsd] = useState(5);
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, setApproved] = useState(false);
  const [blockedDemo, setBlockedDemo] = useState(false);

  async function propose() {
    setBusy(true);
    setMsg(null);
    setQuote(null);
    setApproved(false);
    setBlockedDemo(false);
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
      if (data.quote) setQuote(data.quote);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  /** Video-friendly: clearly BLOCKed bad trade via seatbelt API */
  async function showBlockedBadTrade() {
    setBusy(true);
    setMsg(null);
    setQuote(null);
    setApproved(false);
    setBlockedDemo(true);
    try {
      const res = await fetch("/api/guard/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromSymbol: "USDC",
          toSymbol: "DOGE",
          amountUsd: 500,
          slippageBps: 500,
          stopLossPct: 2,
          feeAwareOk: false,
          rationale: "Deliberate bad trade for seatbelt demo",
          votes: [
            { agent: "trend", vote: "no", reason: "No trend support for meme size" },
            { agent: "risk", vote: "no", reason: "Oversize + fee-unaware" },
          ],
        }),
      });
      const data = await res.json();
      const fakeProposal: TradeProposal = {
        id: data.proposalId || "blocked-demo",
        createdAt: new Date().toISOString(),
        side: "buy",
        fromSymbol: "USDC",
        toSymbol: "DOGE",
        amountUsd: 500,
        amountIn: "500000000",
        estimatedOut: "0",
        estimatedFeeUsd: 1,
        slippageBps: 500,
        stopLossPct: 2,
        trend: "flat",
        rationale: "Deliberate bad trade — oversize, not allowlisted, high slippage.",
        feeAwareOk: false,
        network,
        demo: true,
        votes: [
          { agent: "trend", vote: "no", reason: "No trend support for meme size" },
          { agent: "risk", vote: "no", reason: "Oversize + fee-unaware" },
        ],
        swarmAgreed: false,
      };
      setProposal(fakeProposal);
      setGuard({
        decision: data.decision || "BLOCK",
        reason: data.reason || "blocked",
        checks: data.checks || [],
        proposalId: fakeProposal.id,
      });
      setMsg("Seatbelt BLOCKed a bad trade (allowlist + size + slippage + consensus).");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!proposal || blockedDemo) return;
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
      setMsg("Human approval recorded. Dry-quote anytime; real execute needs mainnet flags + $1 cap.");
      if (data.guard) setGuard(data.guard);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function dryQuote() {
    if (!proposal || blockedDemo) return;
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
      if (data.quote) setQuote(data.quote);
      if (!data.ok) {
        setMsg(data.error || "Quote failed");
        return;
      }
      setMsg(data.quote?.simulated ? "Simulated dry quote (fallback)." : "Live 1Click dry quote.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <h2 className="text-base font-semibold text-white">Proof agent (trader / farmer)</h2>
        <p className="text-xs text-zinc-500">
          Shows the seatbelt on a fee-aware proposal. For Live mainnet, set Amount to $1. Builders: use{" "}
          <code className="text-zinc-400">/api/guard/check</code> directly.
        </p>
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void propose()}
            className="rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 px-4 py-2 text-sm font-semibold"
          >
            {busy ? "Working…" : "Propose trade"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void showBlockedBadTrade()}
            className="rounded-lg border border-red-800 text-red-200 hover:bg-red-950/40 disabled:opacity-50 px-4 py-2 text-sm font-semibold"
          >
            Show blocked bad trade
          </button>
        </div>
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

      {!demo && !blockedDemo && (
        <ExecutePanel
          proposal={proposal}
          network={network}
          demo={demo}
          liveMode={liveMode}
          riskAcknowledged={riskAcknowledged}
          mainnetLiveAllowed={mainnetLiveAllowed}
        />
      )}
    </section>
  );
}
