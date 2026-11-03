"use client";

import { useEffect, useState } from "react";
import { getModal, getSelector, type NearNetwork } from "@/lib/near-wallet";

export function WalletConnect({ network }: { network: NearNetwork }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const selector = await getSelector(network);
        const state = selector.store.getState();
        const acc = state.accounts[0]?.accountId ?? null;
        if (!cancelled) {
          setAccountId(acc);
          setReady(true);
        }
        const unsub = selector.store.observable.subscribe((s) => {
          setAccountId(s.accounts[0]?.accountId ?? null);
        });
        return () => unsub.unsubscribe();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "wallet init failed");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network]);

  async function connect() {
    setError(null);
    try {
      const modal = await getModal(network);
      modal.show();
    } catch (e) {
      setError(e instanceof Error ? e.message : "connect failed");
    }
  }

  async function disconnect() {
    const selector = await getSelector(network);
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-xs text-zinc-400">
        Network: <span className="text-zinc-200 font-mono">{network}</span>
        {network === "mainnet" && (
          <span className="ml-2 text-amber-400">(explicitly enabled)</span>
        )}
      </div>
      {!ready ? (
        <span className="text-sm text-zinc-500">Loading wallet…</span>
      ) : accountId ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-emerald-300">{accountId}</span>
          <button
            type="button"
            onClick={disconnect}
            className="rounded-md border border-zinc-600 px-2 py-1 text-xs hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-2 text-sm font-medium"
        >
          Connect NEAR wallet
        </button>
      )}
      {error && <span className="text-xs text-red-300 max-w-xs text-right">{error}</span>}
      <p className="text-[11px] text-zinc-500 max-w-xs text-right">
        No seed phrases. Signing only via your wallet or a restricted function-call key.
      </p>
    </div>
  );
}
