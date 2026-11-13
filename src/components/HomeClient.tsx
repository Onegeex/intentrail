"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { animate, useInView } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeroScene, type HeroEvent } from "@/components/rail/HeroScene";
import { LiveProvider, useLive } from "@/components/rail/LiveContext";
import { useToast } from "@/components/Toast";
import { AgentChat, type RecordedLlm } from "@/components/vault/AgentChat";
import type { WorstCase } from "@/components/vault/Sections";
import { AttackDemo, type AttackRun } from "@/components/vault/AttackDemo";
import { CONTRACT_SRC, REPO } from "@/components/vault/format";
import { VaultPanel } from "@/components/vault/VaultPanel";
import type { VaultSnapshot } from "@/lib/vault";

const HEADLINE = ["Your agent can trade.", "It can't drain", "the wallet."];
const SITE = "https://intentrail-neon.vercel.app";
const VAULT_FALLBACK = "intentrail-vault7-39ae84.testnet";

const SNIPPET = `// Send only the trade. The guard prices it itself.
const res = await fetch("${SITE}/api/guard/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5 }),
});
const { allowed, checks, computed, ignoredFields } = await res.json();
// computed.costBps comes from a live NEAR Intents quote, not from your agent.`;

function Hero({ stats, held }: { stats: VaultSnapshot["stats"] | null; held: number }) {
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
                <p className="text-xs text-ivory-dim">The real vault on NEAR testnet, since deploy</p>
                <p className="mt-1 text-sm text-ivory">
                  <span className="font-mono text-lg text-proceed">{stats.executed}</span> executed ·{" "}
                  <span className="font-mono text-lg text-danger">{stats.rejected}</span> refused ·{" "}
                  <span className="font-mono text-lg text-caution">{stats.failed}</span> venue refund{stats.failed === 1 ? "" : "s"}
                </p>
                {held > 0 && (
                  <a href="#vault" className="mt-2 inline-flex rounded-full bg-caution px-3 py-1 text-xs font-semibold text-panel-deep">
                    {held} trade{held > 1 ? "s" : ""} waiting for the owner
                  </a>
                )}
              </div>
            )}
            <div className="mt-3 min-h-[4.5rem]" aria-live="polite">
              {event && (
                <motion.div key={`${event.label}-${event.detail}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <p className={`font-display text-2xl font-extrabold tracking-wide ${event.cleared ? "text-proceed" : "text-danger"}`}>
                    {event.label}
                  </p>
                  <p className="text-sm text-ivory/80">{event.detail}</p>
                </motion.div>
              )}
            </div>
            <p className="mt-2 text-xs text-ivory-dim">The animated trains are an illustration. Everything below the fold is real.</p>
          </motion.aside>
        </div>
      </div>
    </header>
  );
}

function CountUp({ to, decimals = 0, prefix = "" }: { to: number; decimals?: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (v: number) => `${prefix}${v.toFixed(decimals)}`;
    if (reduce || !inView) {
      el.textContent = fmt(reduce ? to : 0);
      if (!reduce) return;
      return;
    }
    const c = animate(0, to, { duration: 1.1, ease: [0.2, 0.7, 0.1, 1], onUpdate: (v) => (el.textContent = fmt(v)) });
    return () => c.stop();
  }, [inView, to, decimals, prefix, reduce]);
  return <span ref={ref}>{`${prefix}${to.toFixed(decimals)}`}</span>;
}

function ProofStrip({ attack, worstCase, vaultId, tests }: { attack: AttackRun; worstCase: WorstCase; vaultId: string; tests: number }) {
  const refused = attack.attempts.filter((a) => a.blocked).length;
  const tiles = [
    { big: <CountUp to={refused} />, unit: `of ${refused} attacks refused`, note: "9 on-chain + 3 pre-chain, this run", href: "#attack", tone: "text-danger" },
    { big: <CountUp to={tests} />, unit: "contract tests passing", note: "Bypasses, floors, timelocks, guardian, exits", href: "#how", tone: "text-proceed" },
    worstCase
      ? { big: <CountUp to={worstCase.perDayUsd} decimals={2} prefix="$" />, unit: "a day, worst case", note: `Per key, if our guard server is hacked: the leak budget`, href: "#how", tone: "text-caution" }
      : { big: <span>$100</span>, unit: "daily cap", note: "Set by the owner, enforced by the contract", href: "#how", tone: "text-caution" },
    { big: <span>1</span>, unit: "vault for every demo", note: vaultId, href: `https://testnet.nearblocks.io/address/${vaultId}`, tone: "text-points" },
  ];
  return (
    <div className="relative z-10 mx-auto -mt-px max-w-6xl px-4 sm:px-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[24px] border border-t-0 border-rule bg-rule lg:grid-cols-4">
        {tiles.map((t, i) => (
          <a key={i} href={t.href} className="group space-y-1 bg-panel-deep p-4 transition-colors hover:bg-panel sm:p-5">
            <p className={`font-display text-4xl font-black leading-none tracking-wide sm:text-5xl ${t.tone}`}>{t.big}</p>
            <p className="text-sm font-semibold text-ivory">{t.unit}</p>
            <p className="truncate text-xs text-ivory-dim group-hover:text-ivory/80">{t.note}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

const CHAPTERS = [
  ["attack", "Attacks"],
  ["challenge", "Take the keys"],
  ["agent", "Hijack it"],
  ["how", "How it works"],
  ["drills", "Drills"],
  ["vault", "Live vault"],
  ["status", "What's real"],
  ["why-near", "Why NEAR"],
  ["api", "Intents preview"],
] as const;

function ChapterNav() {
  const [active, setActive] = useState<string>("");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const els = CHAPTERS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return (
    <motion.div
      initial={false}
      animate={{ y: shown ? 0 : -60, opacity: shown ? 1 : 0 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none fixed inset-x-0 top-[61px] z-40 flex justify-center px-3"
    >
      <nav
        aria-label="Sections"
        className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full border border-rule bg-panel-deep/90 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-md"
      >
        {CHAPTERS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className={`relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
              active === id ? "text-panel-deep" : "text-ivory-dim hover:text-ivory"
            }`}
          >
            {active === id && <motion.span layoutId="chapter-pill" className="absolute inset-0 -z-10 rounded-full bg-ivory" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            {label}
          </a>
        ))}
      </nav>
    </motion.div>
  );
}

function Section({ id, title, lede, children }: { id?: string; title: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 space-y-10">
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
        <p className="inline-flex rounded-full bg-points/15 px-3 py-1 text-sm font-semibold text-points">Separate from the vault</p>
        <p>
          A preview of how the guard will price on NEAR Intents. Any agent can send a pair and size, and the guard prices
          it from a live mainnet 1Click quote and returns every check with its numbers.
        </p>
        <p>
          This is not how the vault prices. The vault trades on Ref Finance testnet, and the guard prices every vault trade
          on that same pool. Intents pricing for the vault arrives with the chain-signatures build.
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
  worstCase,
  recordedLlm,
  ownerId,
  recordedAttack,
  howItWorks,
  tests,
  testCount,
  drills,
  status,
  whyNear,
  challenge,
  llmConfigured,
}: {
  vault: VaultSnapshot | null;
  worstCase: WorstCase;
  recordedLlm: RecordedLlm;
  ownerId: string;
  recordedAttack: AttackRun;
  howItWorks: React.ReactNode;
  tests: React.ReactNode;
  testCount: number;
  drills: React.ReactNode;
  status: React.ReactNode;
  whyNear: React.ReactNode;
  challenge: React.ReactNode;
  llmConfigured: boolean;
}) {
  const vaultId = vault?.vaultId ?? VAULT_FALLBACK;
  return (
    <LiveProvider>
      <Hero stats={vault?.stats ?? null} held={vault?.pending.length ?? 0} />
      <ProofStrip attack={recordedAttack} worstCase={worstCase} vaultId={vaultId} tests={testCount} />
      <ChapterNav />
      <main className="mx-auto max-w-6xl space-y-24 overflow-x-hidden px-4 pb-16 pt-20 sm:space-y-32 sm:px-6 sm:pt-28">
        <Section
          id="attack"
          title="We gave the agent's key to an attacker."
          lede="Twelve real attempts to take money out of the vault, and one honest trade for comparison. Each attack is stopped by one of three layers. Click any card for how it worked."
        >
          <AttackDemo recorded={recordedAttack} />
        </Section>

        <div id="challenge" className="scroll-mt-32">
          {challenge}
        </div>

        <Section
          id="agent"
          title="Hijack the agent yourself."
          lede="A real language model on NEAR AI Cloud holds the vault's agent key. We use an abliterated model, one with its refusals removed, and tell it to obey: it's the worst-case agent. In this mode it holds the published challenge keys, agent and guard, so the guard signs whatever the model asks for. Only the contract stands in the way."
        >
          <AgentChat configured={llmConfigured} recorded={recordedLlm} />
          <p className="max-w-4xl rounded-2xl border border-rule bg-panel-deep p-4 text-sm leading-relaxed text-ivory-dim">
            <span className="font-semibold text-ivory">Why PRICE_FLOOR and not SIZE for the $500 sale?</span> The contract
            reports the first check that fails, in this order: caller, kill switch, guard signature, vault, expiry, replay,
            token allowlist, venue, trade shape, minimum output and price floor, size caps, fee ceiling, daily cap. For a swap it
            then reads the pool: value and size again, live pool check, price shock, leak budget. Last comes owner approval. Selling $500 &quot;at any price&quot; fails the price floor before it reaches the size cap. A large trade at a
            fair price is refused at SIZE: see &quot;Use the published guard key to sign a $50 trade&quot; in the attack board.
          </p>
        </Section>

        <div id="how" className="scroll-mt-32 space-y-10">
          {howItWorks}
          {tests}
        </div>

        <div id="drills" className="scroll-mt-32">
          {drills}
        </div>

        <Section
          id="vault"
          title="The vault, live"
          lede="Everything on this panel is read from the chain now. Counters are totals since the vault was deployed, so they won't match one attack run."
        >
          <VaultPanel initial={vault} ownerId={ownerId} worstCase={worstCase} />
        </Section>

        <div id="status" className="scroll-mt-32">
          {status}
        </div>

        {whyNear}

        <Section id="api" title="Intents pricing preview">
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
            <a className="text-ivory hover:underline" href={`https://testnet.nearblocks.io/address/${vaultId}`}>
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
