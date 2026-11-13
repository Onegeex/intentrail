"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { EXPLORER } from "./format";

export type Layer = "near" | "contract" | "dex" | "none";

export type AttemptView = {
  id: string;
  layer: Layer;
  title: string;
  how: string;
  blocked: boolean;
  blockedBy: string;
  result: { txHash?: string; explorerUrl?: string };
};

export type AttackRun = { ranAt: string; priceUsd?: number; attempts: AttemptView[] };

const LAYERS: { id: Layer; n: string; name: string; sub: string; dot: string; chip: string; ring: string }[] = [
  { id: "near", n: "1", name: "NEAR access keys", sub: "Refused before a transaction exists", dot: "bg-points", chip: "bg-points/15 text-points", ring: "border-points/40" },
  { id: "contract", n: "2", name: "IntentRail contract", sub: "Refused on-chain, with the check that fired", dot: "bg-danger", chip: "bg-danger/15 text-danger", ring: "border-danger/40" },
  { id: "dex", n: "3", name: "Ref Finance", sub: "The pool won't pay less than the minimum", dot: "bg-caution", chip: "bg-caution/15 text-caution", ring: "border-caution/40" },
];

function layerOf(a: AttemptView): Layer {
  if (!a.blocked) return "none";
  return a.layer === "none" ? "contract" : a.layer;
}

/** The short code of the check that fired, for the chip. */
function checkCode(a: AttemptView): string {
  const m = a.blockedBy.match(/Contract check ([A-Z_]+)/);
  if (m) return m[1];
  if (/Only the vault's agent key/.test(a.blockedBy)) return "CALLER";
  if (/E68|slippage/.test(a.blockedBy)) return "E68 SLIPPAGE";
  if (/does not allow method/.test(a.blockedBy)) return "METHOD";
  if (/does not match transaction receiver/.test(a.blockedBy)) return "RECEIVER";
  if (/full access/.test(a.blockedBy)) return "FULL ACCESS";
  return a.blocked ? "REFUSED" : "FILLED";
}

/** The error text without our own prefix, for the card body. */
function reason(a: AttemptView): string {
  return a.blockedBy
    .replace(/^Contract check [A-Z_]+: /, "")
    .replace(/^Refused by NEAR: /, "")
    .replace(/^Refused by the contract: /, "")
    .replace(/^Refused at the venue\. /, "");
}

function TxLink({ a }: { a: AttemptView }) {
  if (!a.result.txHash) {
    return (
      <span className="font-mono text-[11px] text-ivory-dim" title="NEAR checks the key before a transaction exists, so a refused one never reaches the chain. The error quoted is NEAR's own.">
        no tx · pre-chain
      </span>
    );
  }
  return (
    <a
      href={a.result.explorerUrl ?? `${EXPLORER}/txns/${a.result.txHash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[11px] text-points underline decoration-points/40 underline-offset-4"
    >
      tx {a.result.txHash.slice(0, 8)}…
    </a>
  );
}

function Card({ a, i, animate }: { a: AttemptView; i: number; animate: boolean }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const l = LAYERS.find((x) => x.id === layerOf(a));
  return (
    <motion.li
      initial={reduce || !animate ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: i * 0.08 }}
      className="group relative flex flex-col gap-2 rounded-2xl border border-rule bg-panel-deep p-4 transition-colors hover:border-ivory-dim/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide ${l?.chip}`}>{checkCode(a)}</span>
        <TxLink a={a} />
      </div>
      <p className="font-display text-xl font-extrabold leading-tight tracking-wide text-ivory">{a.title}</p>
      <p className={`text-xs leading-relaxed text-ivory/80 ${open ? "" : "line-clamp-2"}`}>{reason(a)}</p>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden text-xs leading-relaxed text-ivory-dim"
          >
            {a.how}
          </motion.p>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-[11px] font-semibold text-ivory-dim underline decoration-rule underline-offset-4 hover:text-ivory"
      >
        {open ? "Less" : "How the attack worked"}
      </button>
    </motion.li>
  );
}

export function AttackDemo({ recorded }: { recorded: AttackRun }) {
  const reduce = useReducedMotion();
  const [run, setRun] = useState<AttackRun>(recorded);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(0);

  async function runLive() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/vault/attack", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error || "The attempts couldn't reach NEAR testnet. Try again shortly.");
        return;
      }
      setRun({ ranAt: data.ranAt, priceUsd: data.priceUsd, attempts: data.attempts });
      setLive(true);
      setRevealKey((k) => k + 1);
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const attacks = run.attempts.filter((a) => a.blocked);
  const honest = run.attempts.filter((a) => !a.blocked);
  const by = (l: Layer) => run.attempts.filter((a) => layerOf(a) === l);
  const when = new Date(run.ranAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const animate = revealKey > 0;
  let idx = 0;

  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <div className="flex flex-col gap-5 rounded-[24px] border border-rule bg-panel-raised p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ivory-dim">
            {live ? "Live run" : "Recorded run"} · {when} UTC · this run only
          </p>
          <p className="font-display text-4xl font-black leading-none tracking-wide text-ivory sm:text-5xl">
            <span className="text-danger">{attacks.length}</span> attacks, <span className="text-danger">{attacks.length}</span> refused.{" "}
            <span className="text-proceed">{honest.length}</span> honest trade filled.
          </p>
          <div className="flex h-3 w-full max-w-md gap-1" aria-hidden="true">
            {run.attempts.map((a, i) => {
              const l = LAYERS.find((x) => x.id === layerOf(a));
              return (
                <motion.span
                  key={`${revealKey}-${a.id}`}
                  title={a.title}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: 0.05 * i }}
                  className={`flex-1 origin-bottom rounded-sm ${l ? l.dot : "bg-proceed"}`}
                />
              );
            })}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <motion.button
            type="button"
            onClick={() => void runLive()}
            disabled={busy}
            whileTap={{ scale: 0.97 }}
            className="min-h-12 rounded-full bg-ivory px-6 font-display text-xl font-black tracking-wide text-panel-deep disabled:opacity-60"
          >
            {busy ? "Running on testnet…" : "Run all 12 again, live"}
          </motion.button>
          <p className="max-w-[28ch] text-xs text-ivory-dim sm:text-right">
            {busy ? "Sending real transactions. About a minute." : "8 on-chain, each with a transaction. 3 refused pre-chain by NEAR."}
          </p>
        </div>
      </div>
      {err && <p className="text-sm text-caution">{err}</p>}

      {/* Board: one column per layer of defence */}
      <div key={revealKey} className="grid gap-5 lg:grid-cols-4">
        {LAYERS.map((l) => {
          const items = by(l.id);
          if (!items.length) return null;
          return (
            <section key={l.id} className={l.id === "contract" ? "lg:col-span-2" : ""} aria-label={l.name}>
              <header className={`mb-3 flex items-baseline gap-3 border-t-2 pt-3 ${l.ring}`}>
                <span className="font-display text-3xl font-black text-ivory">{items.length}</span>
                <div>
                  <p className="text-sm font-semibold text-ivory">
                    Layer {l.n} · {l.name}
                  </p>
                  <p className="text-xs text-ivory-dim">{l.sub}</p>
                </div>
              </header>
              <ul className={`grid gap-3 ${l.id === "contract" ? "sm:grid-cols-2" : ""}`}>
                {items.map((a) => (
                  <Card key={a.id} a={a} i={idx++} animate={animate} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {honest.map((a) => (
        <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-proceed/40 bg-proceed/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 shrink-0 rounded-full bg-proceed shadow-[0_0_14px_var(--color-proceed)]" />
            <div>
              <p className="font-display text-2xl font-extrabold tracking-wide text-ivory">{a.title}</p>
              <p className="text-sm text-proceed">{a.blockedBy}</p>
            </div>
          </div>
          <TxLink a={a} />
        </div>
      ))}
    </div>
  );
}
