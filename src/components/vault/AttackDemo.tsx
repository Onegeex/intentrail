"use client";

import { motion, useReducedMotion } from "motion/react";
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

const LAYER: Record<Layer, { label: string; tone: string }> = {
  near: { label: "Refused by NEAR's access keys", tone: "bg-points/15 text-points" },
  contract: { label: "Refused by the IntentRail contract", tone: "bg-danger/15 text-danger" },
  dex: { label: "Refused by Ref Finance", tone: "bg-caution/15 text-caution" },
  none: { label: "Executed", tone: "bg-proceed/15 text-proceed" },
};

function layerOf(a: AttemptView): Layer {
  if (!a.blocked) return "none";
  return a.layer === "none" ? "contract" : a.layer;
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

  const count = (l: Layer) => run.attempts.filter((a) => layerOf(a) === l).length;
  const when = new Date(run.ranAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-3">
          <p className="text-ivory-dim">
            {live ? "Live run" : "Recorded run"}, {when} UTC, on NEAR testnet. {run.attempts.length} transactions signed with
            the agent&apos;s own key or an outside account.
          </p>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(["near", "contract", "dex", "none"] as Layer[]).map((l) =>
              count(l) ? (
                <div key={l} className="flex items-baseline gap-2">
                  <dt className="font-mono text-2xl text-ivory">{count(l)}</dt>
                  <dd className="text-ivory-dim">{l === "none" ? "honest trade executed" : LAYER[l].label.replace("Refused by ", "refused by ")}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
        <motion.button
          type="button"
          onClick={() => void runLive()}
          disabled={busy}
          whileTap={{ scale: 0.97 }}
          className="min-h-12 rounded-full bg-ivory px-6 font-display text-xl font-black tracking-wide text-panel-deep disabled:opacity-60"
        >
          {busy ? "Running on testnet…" : "Run it again, live"}
        </motion.button>
      </div>
      {busy && (
        <p className="text-sm text-ivory-dim" aria-live="polite">
          Sending the transactions to NEAR testnet. This takes about a minute.
        </p>
      )}
      {err && <p className="text-sm text-caution">{err}</p>}

      <ol key={revealKey} className="divide-y divide-rule/70 overflow-hidden rounded-[24px] border border-rule bg-panel-deep">
        {run.attempts.map((a, i) => {
          const l = layerOf(a);
          return (
            <motion.li
              key={a.id}
              initial={reduce || revealKey === 0 ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.15 }}
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
                    No transaction hash: NEAR validates the key before a transaction exists, so a refused one never
                    reaches the chain. The quoted error is NEAR&apos;s own.
                  </p>
                )}
              </div>
              <span className={`justify-self-start rounded-full px-3 py-1 text-sm font-semibold ${LAYER[l].tone}`}>{LAYER[l].label}</span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
