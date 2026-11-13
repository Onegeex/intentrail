"use client";
import challengeKeys from "@/data/challenge.json";
const CHALLENGE_PK = challengeKeys.challenge_agent_public_key;

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { VaultSnapshot } from "@/lib/vault";
import type { WorstCase } from "./Sections";
import { CHECK_LABEL, EXIT_FLOOR_RULE, EXPLORER, STATUS_LABEL, centsToUsd, shortKey, timeAgo, yoctoToNear } from "./format";

type RunResult = {
  intent: string;
  pricing?: string;
  settlement?: string;
  tx: {
    txHash?: string;
    explorerUrl?: string;
    outcome?: { status: string; check: string; detail: string };
    protocolError?: string;
  };
};

const STATUS_TONE: Record<string, string> = {
  Executed: "text-proceed",
  Approved: "text-proceed",
  Rejected: "text-danger",
  PendingApproval: "text-caution",
  Failed: "text-caution",
  Cancelled: "text-ivory-dim",
};

export function VaultPanel({ initial, ownerId, worstCase }: { initial: VaultSnapshot | null; ownerId: string; worstCase: WorstCase }) {
  const [snap, setSnap] = useState<VaultSnapshot | null>(initial);
  const [busy, setBusy] = useState<"small" | "large" | null>(null);
  const [last, setLast] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setSnap(data.vault);
    } catch {
      /* keep the last snapshot */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(size: "small" | "large") {
    setBusy(size);
    setErr(null);
    try {
      const res = await fetch("/api/vault/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error || "The agent couldn't trade just now.");
      } else {
        setLast(data.run);
        await refresh();
      }
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!snap) {
    return (
      <p className="rounded-[24px] border border-rule bg-panel-deep p-6 text-ivory-dim">
        The vault couldn&apos;t be read from NEAR testnet just now. Reload the page to try again.
      </p>
    );
  }

  const p = snap.policy;
  const cap = Number(p.daily_cap_usd_cents);
  const pct = cap ? Math.min(100, (snap.spentTodayCents / cap) * 100) : 0;
  const agentKey = snap.keys.find((k) => !k.fullAccess && k.publicKey !== CHALLENGE_PK);
  const fullKeys = snap.keys.filter((k) => k.fullAccess).length;
  const budget = agentKey?.allowanceYocto ? Number(BigInt(agentKey.allowanceYocto) / BigInt(1e18)) / 1e6 : 0;
  const lowBudget = budget < 0.1;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      {/* State */}
      <div className="space-y-6 rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <a
            href={`${EXPLORER}/address/${snap.vaultId}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm text-points underline decoration-points/40 underline-offset-4"
          >
            {snap.vaultId}
          </a>
          <span className="text-xs text-ivory-dim">Read from testnet {timeAgo(Date.parse(snap.asOf))}</span>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["NEAR", yoctoToNear(snap.balances.nearYocto, 2)],
            ["wNEAR", yoctoToNear(snap.balances.wnearYocto, 2)],
            ["USDT (test)", yoctoToNear(snap.balances.usdtRaw, 2)],
            ["Executed, since deploy", String(snap.stats.executed)],
            ["Refused, since deploy", String(snap.stats.rejected)],
            ["Venue refunds, since deploy", String(snap.stats.failed)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-ivory-dim">{k}</dt>
              <dd className="font-mono text-2xl text-ivory">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-relaxed text-ivory-dim">
          Test token: USDT here is <span className="font-mono">usdt.itachicara.testnet</span>, a community token in a thin
          testnet pool. Its fills show the contract working, not market prices.
        </p>

        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ivory">Spent today</span>
            <span className="font-mono text-ivory">
              {centsToUsd(snap.spentTodayCents)} <span className="text-ivory-dim">of {centsToUsd(cap)}</span>
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-panel">
            <motion.div
              className="h-full rounded-full bg-caution"
              initial={false}
              animate={{ width: `${Math.max(pct, snap.spentTodayCents ? 2 : 0)}%` }}
              transition={{ duration: 0.6 }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">Who can move these funds</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${fullKeys === 0 ? "bg-proceed" : "bg-danger"}`} />
              <span className="text-ivory">
                {fullKeys === 0
                  ? "No full-access keys. Nobody can sign a transfer out of this account."
                  : `${fullKeys} full-access key(s) on the vault.`}
              </span>
            </li>
            {agentKey && (
              <li className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-caution" />
                <span className="text-ivory">
                  Agent key <span className="font-mono text-ivory-dim">{shortKey(agentKey.publicKey)}</span>: may only call{" "}
                  <span className="font-mono">{agentKey.methods.join(", ")}()</span> on the vault, with{" "}
                  {yoctoToNear(agentKey.allowanceYocto, 3)} NEAR left for gas.
                </span>
              </li>
            )}
            <li className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-points" />
              <span className="text-ivory">
                Owner <span className="font-mono text-ivory-dim">{ownerId}</span> approves big trades and can tighten limits at
                once. Withdrawals and looser limits wait {Math.round(snap.timelockMs / 60_000)} minutes. Anyone holding this key
                could queue a withdrawal to itself.
              </span>
            </li>
            {snap.guardianId && (
              <li className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-points" />
                <span className="text-ivory">
                  Guardian <span className="font-mono text-ivory-dim">{snap.guardianId}</span> can pause and veto anything queued.
                  It can&apos;t move funds.
                </span>
              </li>
            )}
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">Limits the contract enforces</h3>
          <dl className="divide-y divide-rule/60 text-sm">
            {[
              ["Kill switch", p.kill_switch ? "On. All trading stopped." : "Off"],
              ["Tokens", p.allowed_tokens.join(", ")],
              ["Venues", p.allowed_venues.join(", ")],
              ["Per trade", `Up to ${centsToUsd(p.max_trade_usd_cents)}, and at most 3 NEAR whatever the price`],
              ["Per day", `Up to ${centsToUsd(p.daily_cap_usd_cents)}`],
              ["Agent alone", `Up to ${centsToUsd(p.approval_above_usd_cents)} per trade. Above that, the owner decides.`],
              ["Fees and price impact", `Up to ${p.max_cost_bps} bps`],
              ...(worstCase
                ? [["If the guard is hacked", `At most about $${worstCase.perDayUsd.toFixed(2)} a day at today's pool prices, until someone pauses`]]
                : []),
              ...((p.exit_tokens ?? []).length
                ? [["Exit floor", EXIT_FLOOR_RULE.replace("Exit floor: a", "A")]]
                : []),
              ...(p.price_floors ?? []).map((f) => [
                `Floor ${f.token_in.split(".")[0]} to ${f.token_out.split(".")[0]}`,
                `At least ${(Number(f.min_out_per_in_e6) / 1e6).toFixed(2)} per unit in, checked by the contract itself`,
              ]),
              [
                "Loosening a limit",
                `Waits ${Math.round(snap.timelockMs / 60_000)} minutes. Tightening applies at once.`,
              ],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-[150px_1fr]">
                <dt className="text-ivory-dim">{k}</dt>
                <dd className="text-ivory">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Actions and log */}
      <div className="space-y-6">
        <div className="space-y-4 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
          <h3 className="font-display text-3xl font-black tracking-wide text-ivory">Make the agent trade</h3>
          <p className="text-sm text-ivory-dim">
            The guard prices the trade from the Ref Finance pool and the live NEAR price, and signs it with a minimum
            output. The agent sends it with its own key. The contract decides, and Ref fills it or refunds it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={busy !== null || lowBudget}
              onClick={() => void run("small")}
              className="min-h-16 rounded-2xl bg-ivory px-4 py-3 text-left text-panel-deep disabled:opacity-60"
            >
              <span className="block font-display text-2xl font-black tracking-wide">
                {busy === "small" ? "Trading…" : "Swap $1.50"}
              </span>
              <span className="block text-sm">Under $4, so the agent decides alone</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={busy !== null || lowBudget}
              onClick={() => void run("large")}
              className="min-h-16 rounded-2xl border border-rule bg-panel px-4 py-3 text-left text-ivory disabled:opacity-60"
            >
              <span className="block font-display text-2xl font-black tracking-wide">
                {busy === "large" ? "Sending…" : "Ask for $6"}
              </span>
              <span className="block text-sm text-ivory-dim">Over $4, so it waits for the owner</span>
            </motion.button>
          </div>
          {err && <p className="text-sm text-caution">{err}</p>}
          {last && (
            <motion.div
              key={last.tx.txHash ?? last.intent}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-rule bg-panel-deep p-4 text-sm"
              aria-live="polite"
            >
              <p className="text-ivory-dim">{last.intent}</p>
              {last.pricing && <p className="mt-1 text-xs text-ivory-dim">{last.pricing}</p>}
              <p
                className={`mt-1 font-display text-2xl font-extrabold tracking-wide ${
                  STATUS_TONE[last.tx.outcome?.status ?? "Rejected"]
                }`}
              >
                {last.tx.outcome ? STATUS_LABEL[last.tx.outcome.status] ?? last.tx.outcome.status : "Not sent"}
              </p>
              <p className="text-ivory">{last.settlement ?? last.tx.outcome?.detail ?? last.tx.protocolError}</p>
              {last.tx.txHash && (
                <a
                  href={last.tx.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-9 items-center font-mono text-xs text-points underline decoration-points/40 underline-offset-4"
                >
                  Transaction {last.tx.txHash.slice(0, 10)}… on NearBlocks
                </a>
              )}
            </motion.div>
          )}
          {snap.pendingWithdrawals.length > 0 && (
            <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-ivory">
              <p className="font-semibold">A withdrawal is waiting out the timelock</p>
              <p className="mt-1 text-ivory-dim">The guardian can veto it before it can go through.</p>
            </div>
          )}
          {lowBudget && (
            <p className="rounded-2xl border border-caution/40 bg-caution/10 p-4 text-sm text-ivory">
              The agent&apos;s gas budget is nearly used up ({budget.toFixed(3)} NEAR left), so live trades are paused until
              the owner refreshes it.
            </p>
          )}
          {snap.pendingPolicy && (
            <div className="rounded-2xl border border-rule bg-panel-deep p-4 text-sm text-ivory">
              <p className="font-semibold">A loosened policy is waiting out the timelock</p>
              <p className="mt-1 text-ivory-dim">
                It can apply from {new Date(Number(snap.pendingPolicy.eta_ms)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC.
                Until then the current limits hold.
              </p>
            </div>
          )}
          {snap.pending.length > 0 && (
            <div className="rounded-2xl border border-caution/40 bg-caution/10 p-4 text-sm text-ivory">
              <p className="font-semibold">
                {snap.pending.length} trade{snap.pending.length > 1 ? "s" : ""} waiting for the owner
              </p>
              <p className="mt-1 text-ivory-dim">
                Only <span className="font-mono">{ownerId}</span> can approve them. Nothing moves until it does.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
          <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">Contract log</h3>
          <p className="text-xs text-ivory-dim">Latest 8 events, stored on-chain by the vault. Newest first.</p>
          <ol className="mt-3 space-y-3">
            {snap.events.slice(0, 8).map((e) => (
              <li key={e.id} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                <span className={`font-semibold ${STATUS_TONE[e.status] ?? "text-ivory"}`}>
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
                <span className="text-right text-xs text-ivory-dim">{timeAgo(e.at_ms)}</span>
                <span className="col-span-2 text-ivory-dim">
                  {e.check !== "OK" && <span className="text-ivory">{CHECK_LABEL[e.check] ?? e.check}: </span>}
                  {e.detail}
                </span>
              </li>
            ))}
            {snap.events.length === 0 && <li className="text-sm text-ivory-dim">No trades yet. Make the agent trade.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}
