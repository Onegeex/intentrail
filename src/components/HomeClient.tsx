"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { FunctionCallKeyPanel } from "@/components/FunctionCallKeyPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { IntegrateSnippet } from "@/components/IntegrateSnippet";
import { LiveDashboard } from "@/components/LiveDashboard";
import { SeatbeltPlayground } from "@/components/SeatbeltPlayground";
import { Tip } from "@/components/Tooltip";
import { WalletConnect } from "@/components/WalletConnect";
import { resetWalletCache, type NearNetwork } from "@/lib/near-wallet";

export function HomeClient({
  mainnetLiveAllowed,
}: {
  mainnetLiveAllowed: boolean;
}) {
  const [liveMode, setLiveMode] = useState(false);
  const [network, setNetwork] = useState<NearNetwork>("testnet");
  const [riskAck, setRiskAck] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
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
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10 space-y-8 sm:space-y-10 overflow-x-hidden">
      {/* Hero */}
      <header className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300/80">
              NEAR HACKATHON · agents · defi · security
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              The seatbelt for AI agents that touch money
            </h1>
            <p className="text-base sm:text-lg text-zinc-300 max-w-xl">
              IntentRail checks every trade proposal before it can move funds — hard caps,
              allowlisted tokens, swarm agreement. Fail-closed by default.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap pt-1">
              <Link
                href="/demo"
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-violet-500 px-5 text-sm font-semibold text-white hover:bg-violet-400"
              >
                Try demo
              </Link>
              <Link
                href="/security"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 px-5 text-sm font-medium text-zinc-100 hover:bg-zinc-900"
              >
                Seatbelt playground
              </Link>
            </div>
          </div>
          <div className="shrink-0">
            <WalletConnect network={network} />
          </div>
        </div>
      </header>

      {/* How it works */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            {
              n: "1",
              title: "Agent proposes",
              body: "Your agent (or this UI) sends a trade idea — pair, size, slippage.",
            },
            {
              n: "2",
              title: "Seatbelt checks",
              body: (
                <>
                  Server runs fail-closed rules: caps,{" "}
                  <Tip label="Only USDC, NEAR, and a few other listed assets can pass. Unknown tokens are blocked.">
                    allowlist
                  </Tip>
                  , fee awareness,{" "}
                  <Tip label="Trend + risk agents must both vote yes, or the trade is blocked.">
                    swarm votes
                  </Tip>
                  .
                </>
              ),
            },
            {
              n: "3",
              title: "You approve",
              body: "PASS proposals can dry-quote or (Live) prepare a ≤$1 deposit you sign in your wallet.",
            },
          ].map((s) => (
            <li
              key={s.n}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-1.5"
            >
              <p className="text-xs font-mono text-violet-300">Step {s.n}</p>
              <p className="text-sm font-semibold text-white">{s.title}</p>
              <p className="text-sm text-zinc-400 leading-snug">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <SeatbeltPlayground />
      <IntegrateSnippet />

      {/* Live mode — secondary */}
      <section className="rounded-2xl border border-sky-900/50 bg-sky-950/20 p-4 sm:p-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              <Tip label="When on, this site can prepare a real ≤$1 NEAR Intents swap. You still sign in your wallet; the server never holds keys.">
                Live mode
              </Tip>
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Optional. Off by default. Caps: ≤$1 per swap, ≤$3 per wallet per day.
            </p>
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={liveMode}
              onChange={(e) => setLiveMode(e.target.checked)}
            />
            Enable Live
          </label>
        </div>
        {liveMode && (
          <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-sky-900/40">
            <label className="text-sm text-zinc-400">
              Network
              <select
                className="mt-1 min-h-11 w-full rounded-lg bg-black border border-zinc-700 px-3 py-2 text-zinc-100"
                value={network}
                onChange={(e) => setNetwork(e.target.value as NearNetwork)}
              >
                <option value="testnet">testnet (default)</option>
                <option value="mainnet" disabled={!mainnetLiveAllowed}>
                  mainnet
                  {!mainnetLiveAllowed ? " — operator disabled" : ""}
                </option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-xs text-zinc-300 sm:mt-6">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={riskAck}
                onChange={(e) => setRiskAck(e.target.checked)}
              />
              I understand Live mainnet can move ≤$1 of my funds per swap after I confirm.
              Server never holds my keys.
            </label>
          </div>
        )}
      </section>

      <LiveDashboard />

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="min-h-11 text-sm text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline"
        >
          {showAdvanced ? "Hide advanced panels" : "Show advanced panels (backtest, FC keys, caps)"}
        </button>
        {showAdvanced && (
          <div className="space-y-6">
            <BacktestPanel />
            <FunctionCallKeyPanel network={network} />
            <GuardrailPanel />
          </div>
        )}
      </div>

      <AgentPanel
        demo={false}
        network={network}
        liveMode={liveMode}
        riskAcknowledged={riskAck}
        mainnetLiveAllowed={mainnetLiveAllowed}
      />

      <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-500 space-y-1">
        <p>
          Judges: open this site → Try demo, or connect wallet → Live → mainnet → risk ack →
          propose $1 USDC→NEAR → approve → prepare → sign deposit. Operator can set{" "}
          <code className="text-zinc-400">MAINNET_DISABLED=true</code> to shut mainnet off.
        </p>
      </footer>
    </main>
  );
}
