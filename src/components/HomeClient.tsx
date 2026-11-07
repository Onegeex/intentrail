"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { HeroScene, type HeroEvent } from "@/components/rail/HeroScene";
import { LiveProvider, useLive } from "@/components/rail/LiveContext";
import { useToast } from "@/components/Toast";
import { AgentChat } from "@/components/vault/AgentChat";
import { AttackDemo, type AttackRun } from "@/components/vault/AttackDemo";
import { CONTRACT_SRC, REPO } from "@/components/vault/format";
import { VaultPanel } from "@/components/vault/VaultPanel";
import type { VaultSnapshot } from "@/lib/vault";

const HEADLINE = ["Your agent can trade.", "It can't drain", "the wallet."];
const SITE = "https://intentrail-neon.vercel.app";

const SNIPPET = `// Send only the trade. The guard prices it itself.
const res = await fetch("${SITE}/api/guard/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5 }),
});
const { allowed, checks, computed, ignoredFields } = await res.json();
// computed.costBps comes from a live NEAR Intents quote, not from your agent.`;

function Hero({ stats }: { stats: VaultSnapshot["stats"] | null }) {
  const reduce = useReducedMotion();
  const { data } = useLive();
  const [event, setEvent] = useState<HeroEvent | null>(null);

  const policy = useMemo(
    () => ({
      allowlist: data?.policy.allowlistedSymbols ?? ["NEAR", "USDC", "WETH", "ETH", "BTC"],
      min: 1,
      max: 10,
    }),
    [data],
  );
  const onEvent = useCallback((e: HeroEvent) => setEvent(e), []);

  return (
    <header className="relative isolate h-[calc(100svh-61px)] min-h-[620px] max-h-[1000px] overflow-hidden border-b border-rule">
      <HeroScene policy={policy} onEvent={onEvent} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[64%] bg-gradient-to-t from-[#070e10] via-[#070e10]/70 to-transparent lg:h-full lg:bg-gradient-to-r lg:from-[#070e10]/95 lg:via-[#070e10]/50 lg:via-40% lg:to-transparent lg:to-65%" />

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
              className="max-w-[50ch] text-lg leading-relaxed text-ivory/85 sm:text-xl"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.85 }}
            >
              IntentRail is a NEAR contract that holds an AI agent&apos;s trading money. The agent&apos;s key can only ask.
              The contract decides, using limits the agent can&apos;t change.
            </motion.p>
            <motion.div
              className="flex flex-wrap items-center gap-3"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1 }}
            >
              <a
                href="#attack"
                className="inline-flex min-h-12 items-center rounded-full bg-ivory px-6 font-display text-xl font-black tracking-wide text-panel-deep transition-transform hover:-translate-y-0.5"
              >
                Watch an attack fail
              </a>
              <a
                href={CONTRACT_SRC}
                className="inline-flex min-h-12 items-center rounded-full border border-ivory/30 bg-black/20 px-6 font-display text-xl font-extrabold tracking-wide text-ivory backdrop-blur-sm hover:border-ivory/60"
              >
                Read the contract
              </a>
            </motion.div>
          </div>

          <motion.aside
            className="hidden rounded-2xl border border-rule/80 bg-[#070e10]/70 p-4 backdrop-blur-md lg:block"
            initial={reduce ? false : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            {stats && (
              <div className="border-b border-rule/70 pb-3">
                <p className="text-xs text-ivory-dim">The real vault on NEAR testnet</p>
                <p className="mt-1 text-sm text-ivory">
                  <span className="font-mono text-lg text-proceed">{stats.executed}</span> trades executed,{" "}
                  <span className="font-mono text-lg text-danger">{stats.rejected}</span> refused
                </p>
              </div>
            )}
            <div className="mt-3 min-h-[4.5rem]" aria-live="polite">
              {event ? (
                <motion.div key={`${event.label}-${event.detail}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <p className={`font-display text-2xl font-extrabold tracking-wide ${event.cleared ? "text-proceed" : "text-danger"}`}>
                    {event.label}
                  </p>
                  <p className="text-sm text-ivory/80">{event.detail}</p>
                </motion.div>
              ) : (
                <p className="text-sm text-ivory-dim">The first trade is on its way.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-ivory-dim">This scene is an illustration. The attempts below are real.</p>
          </motion.aside>
        </div>
      </div>
    </header>
  );
}

function Section({ id, title, lede, children }: { id?: string; title: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-10">
      <div className="max-w-3xl space-y-3">
        <h2 className="font-display text-5xl font-black leading-[0.92] tracking-wide text-ivory sm:text-6xl">{title}</h2>
        {lede && <p className="text-lg leading-relaxed text-ivory-dim">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

function ApiSection() {
  const { push } = useToast();
  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div className="space-y-4 text-lg leading-relaxed text-ivory-dim">
        <p>
          Other agents can use the guard as a preflight check. Send the pair and size. The guard prices the trade from a
          live NEAR Intents 1Click quote and returns every check with its numbers.
        </p>
        <p>
          It ignores anything an agent says about itself, such as its fees, stop-loss or votes, and lists those fields
          under <code className="font-mono text-ivory">ignoredFields</code>. Limits that need memory, like the daily cap,
          live in the vault contract.
        </p>
        <Link href="/security" className="inline-flex min-h-11 items-center text-base font-semibold text-points underline decoration-points/40 underline-offset-4">
          Open the API playground
        </Link>
      </div>
      <div className="overflow-hidden rounded-[24px] border border-rule bg-panel-deep">
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
        <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-relaxed text-ivory sm:text-[13px]">{SNIPPET}</pre>
      </div>
    </div>
  );
}

export function HomeClient({
  vault,
  ownerId,
  recordedAttack,
  howItWorks,
  evidence,
  whyNear,
  llmConfigured,
}: {
  vault: VaultSnapshot | null;
  ownerId: string;
  recordedAttack: AttackRun;
  howItWorks: React.ReactNode;
  evidence: React.ReactNode;
  whyNear: React.ReactNode;
  llmConfigured: boolean;
}) {
  return (
    <LiveProvider>
      <Hero stats={vault?.stats ?? null} />
      <main className="mx-auto max-w-6xl space-y-24 px-4 pb-16 pt-16 sm:space-y-32 sm:px-6 sm:pt-24 overflow-x-hidden">
        <Section
          id="attack"
          title="We gave the agent's key to an attacker."
          lede="Each row is a real attempt to take money out of the vault on NEAR testnet. Three are stopped by NEAR's own access keys before they run. The rest reach the IntentRail contract, or the DEX, and are refused there."
        >
          <AttackDemo recorded={recordedAttack} />
        </Section>

        <div className="space-y-10">
          {howItWorks}
          {evidence}
        </div>

        <Section
          id="agent"
          title="Hijack the agent yourself."
          lede="A real language model, running on NEAR AI Cloud, holds the vault's agent key. It can request trades, and it can sign any transaction it likes. Try to talk it into draining the vault."
        >
          <AgentChat configured={llmConfigured} />
        </Section>

        <Section
          id="vault"
          title="The vault, live"
          lede="Everything on this panel is read from the chain. Make the agent swap and watch the contract decide."
        >
          <VaultPanel initial={vault} ownerId={ownerId} />
        </Section>

        {whyNear}

        <Section id="api" title="A preflight check for any agent">
          <ApiSection />
        </Section>

        <footer className="flex flex-col gap-4 border-t border-rule pt-8 text-sm text-ivory-dim sm:flex-row sm:items-center sm:justify-between">
          <p>IntentRail. Built for the NEAR hackathon. MIT licensed.</p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a className="text-ivory hover:underline" href={REPO}>
              GitHub
            </a>
            <a className="text-ivory hover:underline" href={`${REPO}#readme`}>
              Docs
            </a>
            <a className="text-ivory hover:underline" href={CONTRACT_SRC}>
              Contract
            </a>
            <a className="text-ivory hover:underline" href={`https://testnet.nearblocks.io/address/${vault?.vaultId ?? "intentrail-vault2-39ae84.testnet"}`}>
              Vault on NearBlocks
            </a>
            <Link className="text-ivory hover:underline" href="/mainnet">
              $1 mainnet swap
            </Link>
          </nav>
        </footer>
      </main>
    </LiveProvider>
  );
}
