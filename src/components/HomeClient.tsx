"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { FunctionCallKeyPanel } from "@/components/FunctionCallKeyPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { DepartureBoard, RuleBook } from "@/components/rail/DepartureBoard";
import { HeroScene, type HeroEvent } from "@/components/rail/HeroScene";
import { LiveProvider, useLive } from "@/components/rail/LiveContext";
import { SignalBox } from "@/components/rail/SignalBox";
import { useToast } from "@/components/Toast";
import { WalletConnect } from "@/components/WalletConnect";
import { resetWalletCache, type NearNetwork } from "@/lib/near-wallet";

const HEADLINE = ["Ten signals between", "your agent and", "your money."];

const SNIPPET = `const res = await fetch("https://intentrail-neon.vercel.app/api/guard/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5,
    slippageBps: 50, stopLossPct: 2, feeAwareOk: true,
    votes: [
      { agent: "trend", vote: "yes", reason: "up" },
      { agent: "risk", vote: "yes", reason: "sized" },
    ],
  }),
});
const { allowed, decision, reason, checks } = await res.json();`;

function Hero({ network }: { network: NearNetwork }) {
  const reduce = useReducedMotion();
  const { data } = useLive();
  const [event, setEvent] = useState<HeroEvent | null>(null);
  const [counts, setCounts] = useState({ cleared: 0, held: 0 });

  const policy = useMemo(
    () => ({
      allowlist: data?.policy.allowlistedSymbols ?? ["NEAR", "USDC", "WETH", "ETH", "BTC"],
      min: data?.hardCaps?.minTradeUsd ?? 1,
      max: data?.hardCaps?.maxTradeUsd ?? 50,
    }),
    [data],
  );

  const onEvent = useCallback((e: HeroEvent) => {
    setEvent(e);
    setCounts((c) => (e.cleared ? { ...c, cleared: c.cleared + 1 } : { ...c, held: c.held + 1 }));
  }, []);

  return (
    <header className="relative isolate h-[calc(100svh-61px)] min-h-[600px] max-h-[1000px] overflow-hidden border-b border-rule">
      <HeroScene policy={policy} onEvent={onEvent} />
      {/* Scrim so type stays readable over the scene */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[#070e10] via-[#070e10]/70 to-transparent lg:h-full lg:bg-gradient-to-r lg:from-[#070e10]/95 lg:via-[#070e10]/50 lg:via-40% lg:to-transparent lg:to-65%" />

      <div className="absolute right-4 top-4 hidden sm:block sm:right-6 sm:top-6">
        <WalletConnect network={network} />
      </div>

      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-10 sm:px-6 sm:pb-14 lg:grid-cols-[1fr_300px] lg:items-end">
          <div className="space-y-6">
            <h1 className="font-display font-black leading-[0.88] tracking-[0.01em] text-ivory text-[clamp(2.9rem,6.2vw,6.2rem)] [text-shadow:0_4px_40px_rgba(0,0,0,0.6)]">
              {HEADLINE.map((line, i) => (
                <span key={line} className="block overflow-hidden pb-[0.06em]">
                  <motion.span
                    className="block"
                    initial={reduce ? false : { y: "105%" }}
                    animate={{ y: 0 }}
                    transition={{ duration: 0.9, delay: 0.35 + i * 0.12, ease: [0.2, 0.7, 0.1, 1] }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              className="max-w-[48ch] text-lg leading-relaxed text-ivory/80 sm:text-xl"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.85 }}
            >
              IntentRail checks every trade an AI agent proposes on NEAR Intents before it can move
              funds. One failed check and the trade goes nowhere.
            </motion.p>
            <motion.div
              className="flex flex-wrap items-center gap-3"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1 }}
            >
              <a
                href="#signal-box"
                className="inline-flex min-h-12 items-center rounded-full bg-ivory px-6 font-display text-xl font-black tracking-wide text-panel-deep transition-transform hover:-translate-y-0.5"
              >
                Send a real trade
              </a>
              <Link
                href="/security"
                className="inline-flex min-h-12 items-center rounded-full border border-ivory/30 bg-black/20 px-6 font-display text-xl font-extrabold tracking-wide text-ivory backdrop-blur-sm hover:border-ivory/60"
              >
                Use the API
              </Link>
            </motion.div>
          </div>

          {/* Live caption of what the scene just did */}
          <motion.aside
            className="hidden rounded-2xl border border-rule/80 bg-[#070e10]/70 p-4 backdrop-blur-md lg:block"
            initial={reduce ? false : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 1.2 }}
            aria-live="polite"
          >
            <div className="flex gap-5 text-sm">
              <span className="text-ivory-dim">
                Cleared <span className="font-mono text-lg text-proceed">{counts.cleared}</span>
              </span>
              <span className="text-ivory-dim">
                Held <span className="font-mono text-lg text-danger">{counts.held}</span>
              </span>
            </div>
            <div className="mt-3 min-h-[4.5rem]">
              {event ? (
                <motion.div
                  key={`${event.label}-${counts.cleared + counts.held}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <p className={`font-display text-2xl font-extrabold tracking-wide ${event.cleared ? "text-proceed" : "text-danger"}`}>
                    {event.label}
                  </p>
                  <p className="text-sm text-ivory/80">{event.detail}</p>
                </motion.div>
              ) : (
                <p className="text-sm text-ivory-dim">The first trade is on its way.</p>
              )}
            </div>
            <p className="mt-3 border-t border-rule/70 pt-2 text-xs text-ivory-dim">
              Illustration using the server&apos;s real allowlist and size limit.
            </p>
          </motion.aside>
        </div>
      </div>
    </header>
  );
}

function ApiSection() {
  const { push } = useToast();
  return (
    <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div className="space-y-4">
        <h2 className="font-display text-5xl font-black leading-[0.92] tracking-wide text-ivory sm:text-6xl">
          Put the same signals in front of your own agent.
        </h2>
        <p className="max-w-[44ch] text-lg leading-relaxed text-ivory-dim">
          One POST to <code className="font-mono text-ivory">/api/guard/check</code> returns
          allowed or blocked, with the reason for every check. It works from any origin, and it
          fails closed: anything it can&apos;t verify is blocked.
        </p>
        <Link
          href="/security"
          className="inline-flex min-h-11 items-center text-base font-semibold text-points underline decoration-points/40 underline-offset-4 hover:decoration-points"
        >
          Open the API playground
        </Link>
      </div>
      <div className="overflow-hidden rounded-[28px] border border-rule bg-panel-deep">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <span className="text-sm text-ivory-dim">JavaScript</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(SNIPPET);
                push("Code copied", "ok");
              } catch {
                push("Couldn't copy. Select the code and copy it by hand.", "info");
              }
            }}
            className="min-h-9 rounded-full border border-rule px-4 text-sm text-ivory hover:border-ivory-dim"
          >
            Copy code
          </button>
        </div>
        <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-relaxed text-ivory sm:text-[13px]">
          {SNIPPET}
        </pre>
      </div>
    </section>
  );
}

export function HomeClient({ mainnetLiveAllowed }: { mainnetLiveAllowed: boolean }) {
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
    <LiveProvider>
      <Hero network={network} />
      <div className="sm:hidden px-4 pt-6">
        <WalletConnect network={network} />
      </div>
      <main className="mx-auto max-w-6xl space-y-16 px-4 pt-14 pb-16 sm:space-y-24 sm:px-6 sm:pt-20 overflow-x-hidden">
        <section id="signal-box" className="scroll-mt-24 space-y-8">
          <div className="space-y-3">
            <h2 className="font-display text-5xl font-black leading-[0.92] tracking-wide text-ivory sm:text-6xl">
              Now try the real line.
            </h2>
            <p className="max-w-[52ch] text-lg leading-relaxed text-ivory-dim">
              Every train below is a real call to the seatbelt. Send your own trade and watch each
              signal answer it.
            </p>
          </div>
          <SignalBox />
        </section>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <DepartureBoard />
          <RuleBook />
        </div>

        <ApiSection />

        {/* Control room: real wallet actions */}
        <section className="space-y-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <div className="space-y-3">
              <h2 className="font-display text-5xl font-black leading-[0.92] tracking-wide text-ivory sm:text-6xl">
                Control room
              </h2>
              <p className="max-w-[46ch] text-lg leading-relaxed text-ivory-dim">
                Run the agent yourself. On testnet nothing real moves. Live mode can prepare a
                real swap of $1 or less that you sign in your own wallet.
              </p>
            </div>

            <div className="rounded-[28px] border border-rule bg-panel-raised p-5 space-y-4">
              <label className="flex min-h-11 items-center justify-between gap-4">
                <span>
                  <span className="block font-display text-2xl font-extrabold tracking-wide text-ivory">
                    Live mode
                  </span>
                  <span className="block text-sm text-ivory-dim">
                    Off by default. $1 per swap, $3 per wallet a day.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={liveMode}
                  onClick={() => setLiveMode((v) => !v)}
                  className={`relative h-9 w-16 shrink-0 rounded-full border transition-colors ${
                    liveMode ? "border-caution bg-caution/25" : "border-rule bg-panel-deep"
                  }`}
                >
                  <motion.span
                    className={`absolute top-1 h-6 w-6 rounded-full ${liveMode ? "bg-caution" : "bg-ivory-dim"}`}
                    animate={{ left: liveMode ? 34 : 5 }}
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  />
                  <span className="sr-only">Live mode</span>
                </button>
              </label>
              {liveMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2"
                >
                  <label className="text-sm text-ivory-dim">
                    Network
                    <select
                      className="mt-1 min-h-11 w-full rounded-xl border border-rule px-3 text-ivory"
                      value={network}
                      onChange={(e) => setNetwork(e.target.value as NearNetwork)}
                    >
                      <option value="testnet">Testnet</option>
                      <option value="mainnet" disabled={!mainnetLiveAllowed}>
                        Mainnet{!mainnetLiveAllowed ? " (turned off by the operator)" : ""}
                      </option>
                    </select>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-ivory">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={riskAck}
                      onChange={(e) => setRiskAck(e.target.checked)}
                    />
                    I understand mainnet can move up to $1 of my funds per swap after I sign.
                  </label>
                </motion.div>
              )}
            </div>
          </div>

          <AgentPanel
            demo={false}
            network={network}
            liveMode={liveMode}
            riskAcknowledged={riskAck}
            mainnetLiveAllowed={mainnetLiveAllowed}
          />

          <div className="space-y-6">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
              className="min-h-11 rounded-full border border-rule px-5 text-sm text-ivory hover:border-ivory-dim"
            >
              {showAdvanced ? "Hide backtest, keys and limits" : "Show backtest, keys and limits"}
            </button>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <BacktestPanel />
                <FunctionCallKeyPanel network={network} />
                <GuardrailPanel />
              </motion.div>
            )}
          </div>
        </section>

        <footer className="border-t border-rule pt-8 space-y-4">
          <h2 className="font-display text-2xl font-extrabold tracking-wide text-ivory">
            Judging a real swap
          </h2>
          <ol className="grid gap-3 text-sm text-ivory-dim sm:grid-cols-3 lg:grid-cols-6">
            {[
              "Connect a wallet",
              "Turn on Live mode",
              "Pick mainnet and confirm the risk",
              "Propose $1 USDC to NEAR",
              "Approve and prepare the quote",
              "Sign the deposit in your wallet",
            ].map((s, i) => (
              <li key={s} className="flex gap-2">
                <span className="font-display text-xl font-black leading-none text-caution">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-ivory-dim">
            The operator can shut mainnet off at any time with{" "}
            <code className="font-mono text-ivory">MAINNET_DISABLED=true</code>.
          </p>
        </footer>
      </main>
    </LiveProvider>
  );
}
