import challenge from "@/data/challenge.json";
import trading from "@/data/trading-drills.json";
import type { LaneView } from "@/lib/vault";
import { CopyButton } from "./CopyButton";
import { CHECK_LABEL, EXPLORER, REPO, centsToUsd, shortKey } from "./format";
import { SectionHead } from "./Sections";

const RUN = `git clone ${REPO} && cd intentrail && npm i
node scripts/challenge.mjs --wnear 0.3 --give-away 3      # minimum 3% under the live pool
node scripts/challenge.mjs --wnear 0.3 --claim-usd 0.01   # lie about the trade's value
node scripts/challenge.mjs --wnear 200                    # far over the size cap
node scripts/challenge.mjs --method withdraw              # anything but execute()`;

function Meter({ label, value, max, note }: { label: string; value: number; max: number; note: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ivory-dim">{label}</span>
        <span className="font-mono text-ivory">{note}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-rule">
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct > 60 ? "bg-caution" : "bg-proceed"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-ivory-dim">{label}</p>
        <p className="truncate font-mono text-sm text-ivory" title={value}>
          {shortKey(value)}
        </p>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

export function Challenge({
  lanes,
  leakBudgetCents,
  challengeCapCents,
  autonomyCents,
}: {
  lanes: LaneView[];
  leakBudgetCents: number;
  challengeCapCents: number;
  autonomyCents: number;
}) {
  const lane = lanes.find((l) => l.lane === "challenge");
  return (
    <section className="space-y-10">
      <SectionHead
        title="Here are the keys. Take the money."
        lede={
          <>
            Most agent guards ask you to trust their server. We published ours. Below are a working agent key for{" "}
            <span className="font-mono text-ivory">{challenge.vault}</span> and a guard signing key the contract accepts.
            Together they are everything a hacked agent and a hacked guard would have. Sign any trade you like.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4 rounded-[24px] border border-caution/40 bg-panel-deep p-5 sm:p-7">
          <h3 className="font-display text-2xl font-extrabold tracking-wide text-ivory">The published keys</h3>
          <div>
            <KeyRow label="Agent private key (function-call, execute() only)" value={challenge.challenge_agent_private_key} />
            <KeyRow label="Guard signing seed (ed25519, base64)" value={challenge.challenge_guard_seed_b64} />
            <KeyRow label="Vault" value={challenge.vault} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ivory">Try it</p>
              <CopyButton text={RUN} label="Copy commands" />
            </div>
            <pre className="overflow-x-auto rounded-xl border border-rule bg-[#070e10] p-4 font-mono text-xs leading-relaxed text-ivory/90">{RUN}</pre>
          </div>
          <p className="text-sm leading-relaxed text-ivory-dim">
            These keys trade in their own lane: own daily cap ({centsToUsd(challengeCapCents)}), own leak budget, own
            strikes. So your attempts can&apos;t freeze the real agent, and the real agent&apos;s trades don&apos;t eat your
            budget. Every call you make is public on NearBlocks.
          </p>
        </div>

        <div className="space-y-5 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
          <h3 className="font-display text-2xl font-extrabold tracking-wide text-ivory">The challenge lane, live</h3>
          {lane ? (
            <>
              <Meter
                label="Spent today"
                value={Number(lane.spent_today_cents)}
                max={challengeCapCents}
                note={`${centsToUsd(lane.spent_today_cents)} of ${centsToUsd(challengeCapCents)}`}
              />
              <Meter
                label="Value given up today"
                value={Number(lane.leak_today_cents)}
                max={leakBudgetCents}
                note={`${centsToUsd(lane.leak_today_cents)} of ${centsToUsd(leakBudgetCents)}`}
              />
              <Meter
                label="Refusal strikes"
                value={lane.strikes}
                max={8}
                note={`${lane.strikes} · autonomy ${centsToUsd(lane.autonomy_usd_cents)} of ${centsToUsd(autonomyCents)}`}
              />
            </>
          ) : (
            <p className="text-sm text-ivory-dim">Couldn&apos;t read the lane from the chain just now.</p>
          )}
          <ul className="space-y-2 text-sm leading-relaxed text-ivory/90">
            <li>
              <span className="font-semibold text-ivory">Live pool check.</span> Before sending a swap, the contract asks
              Ref for the price itself. A signed minimum more than 1% under it is refused.
            </li>
            <li>
              <span className="font-semibold text-ivory">Price-shock hold.</span> If the pool is more than 3% away from
              the vault&apos;s own moving reference, the trade waits for the owner.
            </li>
            <li>
              <span className="font-semibold text-ivory">Leak budget.</span> Every bit given up against the higher of the
              live and reference price is added up per key per day. Lots of &quot;fair&quot; trades still run out.
            </li>
            <li>
              <span className="font-semibold text-ivory">Adaptive autonomy.</span> Each refusal halves what the key may
              trade without the owner. One strike wears off every 15 minutes.
            </li>
            <li>
              <span className="font-semibold text-ivory">Its own valuation.</span> The contract values the trade on the
              pool and keeps the higher of that and the guard&apos;s claim, so a lying guard can&apos;t stretch the caps.
            </li>
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">Trading attacks, run on testnet</h3>
        <p className="max-w-3xl text-sm text-ivory-dim">{trading.note}</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trading.steps.map((s) => (
            <article key={s.id} className="flex flex-col gap-2 rounded-2xl border border-rule bg-panel-deep p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                    s.blocked ? "bg-danger/15 text-danger" : "bg-proceed/15 text-proceed"
                  }`}
                >
                  {s.blocked ? CHECK_LABEL[s.check] ?? s.check : "Executed"}
                </span>
              </div>
              <p className="font-semibold text-ivory">{s.title}</p>
              <p className="text-sm text-ivory-dim">{s.how}</p>
              <p className="text-sm text-ivory">{s.result}</p>
              <a
                href={`${EXPLORER}/txns/${s.tx}`}
                target="_blank"
                rel="noreferrer"
                className="mt-auto font-mono text-xs text-points underline decoration-points/40 underline-offset-4"
              >
                {s.tx.slice(0, 10)}… on NearBlocks
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
