"use client";

import { useCallback, useEffect, useState } from "react";
import { getSelector, signFtDeposit, type NearNetwork } from "@/lib/near-wallet";
import type { QuoteResult, TradeProposal } from "@/lib/types";

const MAX_MAINNET_SWAP_USD = 1;

/**
 * Hosted Live mainnet path: prepare 1Click deposit → visitor signs ft_transfer.
 * Requires Live mode + mainnet + risk ack + wallet. Caps at $1.
 */
export function ExecutePanel({
  proposal,
  network,
  demo,
  liveMode,
  riskAcknowledged,
  mainnetLiveAllowed,
}: {
  proposal: TradeProposal | null;
  network: NearNetwork;
  demo?: boolean;
  liveMode: boolean;
  riskAcknowledged: boolean;
  mainnetLiveAllowed: boolean;
}) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCap, setConfirmCap] = useState(false);

  const refreshAccount = useCallback(async () => {
    try {
      const selector = await getSelector(network);
      const state = await selector.store.getState();
      setAccountId(state.accounts[0]?.accountId || null);
    } catch {
      setAccountId(null);
    }
  }, [network]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  if (demo) return null;

  const canLive =
    liveMode && network === "mainnet" && mainnetLiveAllowed && riskAcknowledged;

  async function prepare() {
    if (!proposal) return;
    setBusy(true);
    setMsg(null);
    setQuote(null);
    try {
      if (!accountId) {
        setMsg("Connect your NEAR wallet first.");
        return;
      }
      if (!canLive) {
        setMsg("Enable Live mode, select mainnet, and accept the risk acknowledgement.");
        return;
      }
      if (proposal.amountUsd > MAX_MAINNET_SWAP_USD) {
        setMsg(
          `Client block: amount $${proposal.amountUsd} exceeds mainnet cap $${MAX_MAINNET_SWAP_USD}. Propose ≤ $1.`,
        );
        return;
      }
      if (!confirmCap) {
        setMsg("Confirm the $1 per-swap cap for this trade.");
        return;
      }
      const res = await fetch("/api/execute/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          proposal: {
            id: proposal.id,
            createdAt: proposal.createdAt,
            side: proposal.side,
            fromSymbol: proposal.fromSymbol,
            toSymbol: proposal.toSymbol,
            amountUsd: proposal.amountUsd,
            amountIn: proposal.amountIn,
            estimatedOut: proposal.estimatedOut,
            estimatedFeeUsd: proposal.estimatedFeeUsd,
            slippageBps: proposal.slippageBps,
            stopLossPct: proposal.stopLossPct,
            trend: proposal.trend,
            rationale: proposal.rationale,
            feeAwareOk: proposal.feeAwareOk,
            network: "mainnet",
            demo: false,
            votes: proposal.votes,
            swarmAgreed: proposal.swarmAgreed === true,
            riskInputs: proposal.riskInputs,
          },
          accountId,
          liveMode: true,
          network: "mainnet",
          riskAcknowledged: true,
          confirmExecute: true,
          confirmMainnetCap: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || "Prepare failed");
        if (data.quote) setQuote(data.quote);
        return;
      }
      // Client re-check before showing sign
      const q = data.quote as QuoteResult;
      const usd = Number(q.amountInUsd ?? proposal.amountUsd);
      if (!q.depositAddress || !q.amountIn || !q.depositContractId) {
        setMsg("Client refused: incomplete deposit quote");
        return;
      }
      if (usd > MAX_MAINNET_SWAP_USD + 0.05) {
        setMsg("Client refused: quoted USD over $1 cap");
        return;
      }
      setQuote(q);
      setMsg("Executable quote ready — review deposit, then Sign deposit.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function signDeposit() {
    if (!quote?.depositAddress || !quote.depositContractId || !quote.amountIn) return;
    setBusy(true);
    setMsg(null);
    try {
      const usd = Number(quote.amountInUsd ?? proposal?.amountUsd ?? 99);
      if (usd > MAX_MAINNET_SWAP_USD + 0.05) {
        setMsg("Client refused sign: over $1 cap.");
        return;
      }
      if (!quote.depositAddress || quote.depositAddress.length < 2) {
        setMsg("Client refused sign: missing deposit address");
        return;
      }
      const result = await signFtDeposit({
        network,
        tokenContractId: quote.depositContractId,
        depositAddress: quote.depositAddress,
        amount: quote.amountIn,
        memo: quote.depositMemo,
      });
      if (result.error) {
        setMsg(result.error);
        return;
      }
      setMsg(`Deposit submitted (${result.txHash || "ok"}). Polling status…`);
      await poll(quote.depositAddress);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function poll(depositAddress: string) {
    for (let i = 0; i < 12; i++) {
      const res = await fetch(
        `/api/execute/status?depositAddress=${encodeURIComponent(depositAddress)}`,
      );
      const data = await res.json();
      setStatus(data.status || data.message || "unknown");
      if (["SUCCESS", "REFUNDED", "FAILED"].includes(String(data.status))) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-5 space-y-3">
      <h2 className="text-base font-semibold text-white">Live ≤$1 swap (hosted)</h2>
      <p className="text-xs text-zinc-400">
        Works on this site — no local code. Toggle <strong>Live mode</strong>, pick{" "}
        <strong>mainnet</strong>, connect wallet, propose <strong>$1</strong>, then prepare +
        sign. Hard caps: ${MAX_MAINNET_SWAP_USD}/swap, $3/wallet/day.
      </p>
      <p className="text-xs font-mono text-zinc-500">
        live={String(liveMode)} · network={network} · riskAck={String(riskAcknowledged)} ·
        wallet={accountId || "(connect wallet)"} · operator=
        {mainnetLiveAllowed ? "allowed" : "MAINNET_DISABLED"}
      </p>
      <label className="flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={confirmCap}
          onChange={(e) => setConfirmCap(e.target.checked)}
          className="mt-0.5"
        />
        I confirm this specific swap is ≤ ${MAX_MAINNET_SWAP_USD} and I will review the deposit
        address before signing.
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !proposal || !canLive}
          onClick={() => void prepare()}
          className="rounded-lg bg-amber-500/90 text-black hover:bg-amber-400 disabled:opacity-50 px-3 py-2 text-sm font-semibold"
        >
          Prepare executable quote
        </button>
        <button
          type="button"
          disabled={busy || !quote?.depositAddress}
          onClick={() => void signDeposit()}
          className="rounded-lg border border-amber-700 text-amber-100 hover:bg-amber-950/50 disabled:opacity-50 px-3 py-2 text-sm font-semibold"
        >
          Sign deposit (wallet)
        </button>
      </div>
      {quote?.depositAddress && (
        <dl className="text-xs font-mono text-zinc-400 space-y-1">
          <div>deposit: {quote.depositAddress}</div>
          <div>
            amount: {quote.amountIn} (~{quote.amountInUsd} USD) via {quote.depositContractId}
          </div>
        </dl>
      )}
      {status && <p className="text-sm text-emerald-300">Status: {status}</p>}
      {msg && <p className="text-sm text-amber-200">{msg}</p>}
    </section>
  );
}
