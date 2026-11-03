"use client";

import { useEffect, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { FunctionCallKeyPanel } from "@/components/FunctionCallKeyPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { IntegrateSnippet } from "@/components/IntegrateSnippet";
import { LiveDashboard } from "@/components/LiveDashboard";
import { WalletConnect } from "@/components/WalletConnect";
import { resetWalletCache, type NearNetwork } from "@/lib/near-wallet";
import Link from "next/link";

export function HomeClient({
  mainnetLiveAllowed,
}: {
  mainnetLiveAllowed: boolean;
}) {
  const [liveMode, setLiveMode] = useState(false);
  const [network, setNetwork] = useState<NearNetwork>("testnet");
  const [riskAck, setRiskAck] = useState(false);

  useEffect(() => {
    // Switching network requires a fresh wallet-selector instance
    resetWalletCache();
  }, [network]);

  useEffect(() => {
    if (!liveMode) {
      setNetwork("testnet");
      setRiskAck(false);
    }
  }, [liveMode]);

  useEffect(() => {
    if (liveMode && network === "mainnet" && !mainnetLiveAllowed) {
      setNetwork("testnet");
    }
  }, [liveMode, network, mainnetLiveAllowed]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/80 mb-2">
            NEAR HACKATHON · seatbelt for agents · defi · security
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            IntentRail
          </h1>
          <p className="mt-2 text-lg text-zinc-200 max-w-xl font-medium">
            The seatbelt for AI agents that touch money.
          </p>
          <p className="mt-2 text-zinc-400 max-w-xl text-sm">
            Built for <strong className="text-zinc-200">agent builders</strong>. Proof UI:
            connect your wallet on this site, toggle <strong>Live mode</strong>, swap ≤$1 on
            mainnet — no local install. Server never holds keys.
          </p>
          <p className="mt-3 text-sm">
            <Link className="text-sky-400 hover:underline" href="/demo">
              Demo mode (no wallet)
            </Link>
            {" · "}
            <Link className="text-sky-400 hover:underline" href="/security">
              Security model
            </Link>
            {" · "}
            <a className="text-sky-400 hover:underline" href="/api/guard/check">
              Guard API
            </a>
          </p>
        </div>
        <WalletConnect network={network} />
      </header>

      <section className="rounded-2xl border border-sky-900/50 bg-sky-950/20 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Live mode</h2>
            <p className="text-xs text-zinc-400 mt-1">
              Off by default. Enable to prepare real ≤$1 NEAR Intents swaps on this hosted site.
              You sign in your wallet; IntentRail only fetches the deposit address.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={liveMode}
              onChange={(e) => setLiveMode(e.target.checked)}
            />
            Live mode
          </label>
        </div>
        {liveMode && (
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-sky-900/40">
            <label className="text-sm text-zinc-400">
              Network
              <select
                className="mt-1 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-zinc-100"
                value={network}
                onChange={(e) => setNetwork(e.target.value as NearNetwork)}
              >
                <option value="testnet">testnet (default)</option>
                <option value="mainnet" disabled={!mainnetLiveAllowed}>
                  mainnet (opt-in{!mainnetLiveAllowed ? " — operator disabled" : ""})
                </option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-xs text-zinc-300 mt-6">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={riskAck}
                onChange={(e) => setRiskAck(e.target.checked)}
              />
              I understand Live mainnet can move ≤$1 of my funds per swap (≤$3/day per wallet)
              after I confirm each trade. Server never holds my keys.
            </label>
          </div>
        )}
      </section>

      <IntegrateSnippet />
      <LiveDashboard />
      <BacktestPanel />
      <FunctionCallKeyPanel network={network} />
      <GuardrailPanel />
      <AgentPanel
        demo={false}
        network={network}
        liveMode={liveMode}
        riskAcknowledged={riskAck}
        mainnetLiveAllowed={mainnetLiveAllowed}
      />

      <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-500 space-y-1">
        <p>
          Judges: open this site → connect wallet → toggle Live → select mainnet → risk ack →
          propose $1 USDC→NEAR → approve → prepare → sign deposit → watch status. No local
          code required. Operator can set <code className="text-zinc-400">MAINNET_DISABLED=true</code>{" "}
          to shut mainnet off globally.
        </p>
      </footer>
    </main>
  );
}
