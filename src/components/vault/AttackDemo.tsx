"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { EXPLORER } from "./format";

export type AttemptView = {
  id: string;
  title: string;
  how: string;
  expected: "protocol" | "contract" | "executes";
  blocked: boolean;
  blockedBy: string;
  result: { txHash?: string; explorerUrl?: string };
};

export type AttackRun = { ranAt: string; priceUsd?: number; attempts: AttemptView[] };

function Verdict({ a }: { a: AttemptView }) {
  if (!a.blocked) {
    return <span className="rounded-full bg-proceed/15 px-3 py-1 text-sm font-semibold text-proceed">Executed</span>;
  }
  const byNear = !a.result.txHash;
  return (
    <span className="rounded-full bg-danger/15 px-3 py-1 text-sm font-semibold text-danger">
      {byNear ? "Refused by NEAR" : "Refused by the contract"}
    </span>
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

  const refused = run.attempts.filter((a) => a.blocked).length;
  const attacks = run.attempts.filter((a) => a.expected !== "executes").length;
  const when = new Date(run.ranAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-ivory-dim">
          {live ? "Live run" : "Recorded run"}, {when} UTC, on NEAR testnet.{" "}
          <span className="text-ivory">
            {refused} of {attacks} attacks refused
          </span>
          , then one honest trade went through.
        </p>
        <motion.button
          type="button"
          onClick={() => void runLive()}
          disabled={busy}
          whileTap={{ scale: 0.97 }}
          className="min-h-12 shrink-0 rounded-full bg-ivory px-6 font-display text-xl font-black tracking-wide text-panel-deep disabled:opacity-60"
        >
          {busy ? "Running on testnet…" : "Run it again, live"}
        </motion.button>
      </div>
      {busy && (
        <p className="text-sm text-ivory-dim" aria-live="polite">
          Sending 8 transactions to NEAR testnet with the agent&apos;s own key. This takes about a minute.
        </p>
      )}
      {err && <p className="text-sm text-caution">{err}</p>}

      <ol key={revealKey} className="divide-y divide-rule/70 overflow-hidden rounded-[24px] border border-rule bg-panel-deep">
        {run.attempts.map((a, i) => (
          <motion.li
            key={a.id}
            initial={reduce || revealKey === 0 ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.18 }}
            className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-start sm:p-5"
          >
            <div className="space-y-1.5">
              <p className="font-display text-2xl font-extrabold tracking-wide text-ivory">{a.title}</p>
              <p className="text-sm text-ivory-dim">{a.how}</p>
              <p className={`text-sm ${a.blocked ? "text-ivory" : "text-proceed"}`}>{a.blockedBy}</p>
              {a.result.txHash ? (
                <a
                  href={a.result.explorerUrl ?? `${EXPLORER}/txns/${a.result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center font-mono text-xs text-points underline decoration-points/40 underline-offset-4"
                >
                  Transaction {a.result.txHash.slice(0, 10)}… on NearBlocks
                </a>
              ) : (
                <p className="text-xs text-ivory-dim">
                  NEAR rejected the transaction before it ran, so there&apos;s nothing on-chain to link.
                </p>
              )}
            </div>
            <Verdict a={a} />
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
