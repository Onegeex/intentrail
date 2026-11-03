"use client";

import { useCallback, useEffect, useState } from "react";
import { getSelector, signFtDeposit, type NearNetwork } from "@/lib/near-wallet";
import type { QuoteResult, TradeProposal } from "@/lib/types";

const MAX_MAINNET_SWAP_USD = 1;

/**
 * Real execution path UI. Only works when dual mainnet flags are on locally.
 * Never auto-signs; requires explicit clicks. Caps at $1.
 */
export function ExecutePanel({
  proposal,
  network,
  demo,
}: {
  proposal: TradeProposal | null;
  network: NearNetwork;
  demo?: boolean;
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
      const id = state.accounts[0]?.accountId || null;
      setAccountId(id);
    } catch {
      setAccountId(null);
    }
  }, [network]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  async function prepare() {
    if (!proposal) return;
    setBusy(true);
    setMsg(null);
    setQuote(null);
    try {
      if (!accountId) {
        setMsg("Connect a NEAR wallet first.");
        return;
      }
      if (proposal.amountUsd > MAX_MAINNET_SWAP_USD) {
        setMsg(
          `Client block: amount $${proposal.amountUsd} exceeds mainnet cap $${MAX_MAINNET_SWAP_USD}. Propose ≤ $1.`,
        );
        return;
      }
      if (!confirmCap) {
        setMsg("Check the $1 mainnet cap confirmation.");
        return;
      }
      const res = await fetch("/api/execute/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          accountId,
          confirmExecute: true,
          confirmMainnetCap: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || "Prepare failed (flags off on public demo is expected)");
        if (data.quote) setQuote(data.quote);
        return;
      }
      setQuote(data.quote);
      setMsg("Executable quote ready — review deposit, then sign in your wallet.");
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
      if ((Number(quote.amountInUsd) || proposal?.amountUsd || 99) > MAX_MAINNET_SWAP_USD) {
        setMsg("Client refused sign: over $1 cap.");
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

  if (demo) return null;

  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-5 space-y-3">
      <h2 className="text-base font-semibold text-white">Real $1 swap path (opt-in)</h2>
      <p className="text-xs text-zinc-400">
        Non-dry 1Click → deposit address → <strong className="text-zinc-200">you</strong> sign in
        wallet → status poll. Hard cap <code className="text-amber-200">${MAX_MAINNET_SWAP_USD}</code>.
        Requires local <code className="text-zinc-300">NEAR_NETWORK=mainnet</code> +{" "}
        <code className="text-zinc-300">ALLOW_MAINNET=true</code>. Public demo keeps flags off.
        IntentRail never auto-executes.
      </p>
      <p className="text-xs font-mono text-zinc-500">
        wallet={accountId || "(not connected)"} · network={network}
      </p>
      <label className="flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={confirmCap}
          onChange={(e) => setConfirmCap(e.target.checked)}
          className="mt-0.5"
        />
        I understand this can move ≤ ${MAX_MAINNET_SWAP_USD} of my funds on mainnet after I
        click Sign deposit.
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !proposal}
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
            amount: {quote.amountIn} ({quote.amountInUsd} USD) via {quote.depositContractId}
          </div>
        </dl>
      )}
      {status && <p className="text-sm text-emerald-300">Status: {status}</p>}
      {msg && <p className="text-sm text-amber-200">{msg}</p>}
    </section>
  );
}
