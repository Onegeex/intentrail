import drills from "@/data/drills.json";
import { CONTRACT_SRC, CONTRACT_TESTS, EXPLORER, REPO } from "./format";

export function SectionHead({ title, lede }: { title: string; lede?: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-3">
      <h2 className="font-display text-5xl font-black leading-[0.92] tracking-wide text-ivory sm:text-6xl">{title}</h2>
      {lede && <p className="text-lg leading-relaxed text-ivory-dim">{lede}</p>}
    </div>
  );
}

const STEPS = [
  {
    who: "Agent",
    title: "Proposes a trade",
    body: "Pair and size only. Anything it says about its own fees, stop-loss or confidence is ignored. It can be an LLM, a script, or a hijacked version of either.",
  },
  {
    who: "Guard server",
    title: "Prices it and signs it",
    body: "It quotes the trade on the DEX pool itself, measures fees and price impact, sets a minimum output 0.5% under the quote, values it with the live NEAR price, and signs it for this vault only, once, for two minutes. It has no trading strategy.",
  },
  {
    who: "GuardVault contract",
    title: "Checks its own limits",
    body: "Caller, signature, freshness, replay, token and venue allowlists, per-trade cap in USD and in raw tokens, daily cap, fee ceiling, the owner's price floor, kill switch. Above $4 it waits for the owner.",
  },
  {
    who: "Venue",
    title: "Fills or refunds",
    body: "The contract writes the Ref Finance swap itself. Ref pays out at least the minimum to the vault, or reverts and the tokens come back. No trade has a recipient field.",
  },
];

export type WorstCase = { perTradeUsd: number; perDayUsd: number; worstGapPct: number; autonomousMaxUsd: number; dailyCapUsd: number } | null;

export function HowItWorks({ worstCase }: { worstCase: WorstCase }) {
  return (
    <section className="space-y-10">
      <SectionHead
        title="Where enforcement lives"
        lede="In the contract that holds the money. The server can refuse to sign, but it can't make the contract accept a trade outside the owner's limits."
      />
      <ol className="grid gap-px overflow-hidden rounded-[24px] border border-rule bg-rule md:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="space-y-2 bg-panel-deep p-5">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-4xl font-black text-caution">{i + 1}</span>
              <span className="text-sm text-ivory-dim">{s.who}</span>
            </div>
            <p className="font-display text-2xl font-extrabold tracking-wide text-ivory">{s.title}</p>
            <p className="text-sm leading-relaxed text-ivory-dim">{s.body}</p>
          </li>
        ))}
      </ol>

      {worstCase && (
        <div className="grid gap-4 rounded-[24px] border border-caution/40 bg-caution/[0.08] p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-caution">Worst case if our guard server is hacked</p>
            <p className="font-display text-5xl font-black leading-none tracking-wide text-ivory">
              ${worstCase.perDayUsd.toFixed(2)}
              <span className="text-2xl text-ivory-dim"> a day</span>
            </p>
            <p className="mt-1 font-mono text-sm text-ivory-dim">
              {worstCase.worstGapPct}% × ${worstCase.dailyCapUsd} daily cap · ${worstCase.perTradeUsd.toFixed(2)} a trade
            </p>
          </div>
          <p className="text-sm leading-relaxed text-ivory/90">
            A hacked guard can sign trades right at the owner&apos;s price floor, {worstCase.worstGapPct}% under today&apos;s
            pool price, up to ${worstCase.autonomousMaxUsd} a trade before the owner must approve. Everything else on this
            page still holds, and the owner or guardian can pause at once. Floors are fixed numbers today: if the price
            rises the gap widens, and if it falls they block sales (the crash exit covers that). They need re-tuning, or an
            oracle-relative floor, which is designed but not built.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TRUST(worstCase).map((t) => (
          <article key={t.who} className={`flex flex-col gap-3 rounded-2xl border bg-panel-deep p-5 ${t.root ? "border-caution/50" : "border-rule"}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-2xl font-extrabold leading-tight tracking-wide text-ivory">{t.who}</h3>
              {t.root && <span className="rounded-full bg-caution/15 px-2.5 py-0.5 text-[11px] font-semibold text-caution">Trust root</span>}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-danger">Can</p>
              <p className="text-sm leading-relaxed text-ivory-dim">{t.can}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-proceed">Can&apos;t</p>
              <p className="text-sm leading-relaxed text-ivory">{t.cant}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TRUST(w: WorstCase): { who: string; can: string; cant: string; root?: boolean }[] {
  return [
    {
      who: "The agent, or its prompt",
      can: "Ask for trades.",
      cant: "Edit a signed quote, replay one, call any method but execute(), touch tokens directly, or exceed any limit.",
    },
    {
      who: "The agent's key",
      can: "Send execute() calls and spend its gas budget. Without a guard signature they all fail.",
      cant: "Transfer, add keys, delete the account, or call another contract. NEAR's protocol refuses.",
    },
    {
      who: "The guard server and its key",
      can: w
        ? `Sign bad-but-allowed trades until someone notices: about $${w.perTradeUsd.toFixed(2)} a trade and $${w.perDayUsd.toFixed(2)} a day at today's pool price.`
        : "Sign bad-but-allowed trades until someone notices, down to the owner's price floor.",
      cant: "Sell below the floor, exceed any cap, add a venue, or skip owner approval. Once the key is rotated, its quotes are worthless.",
    },
    {
      who: "Anyone else",
      can: "Read the vault.",
      cant: "Call execute(), even with a genuine signed quote. Only the agent key or the owner may.",
    },
    {
      who: "The owner's key alone",
      can: "Queue a withdrawal to the owner account, which the attacker now controls. Queue looser limits. Exit into the stablecoin at once, but at most 10% under the last guard-signed rate.",
      cant: "Take anything out before the timelock (10 minutes on testnet, a day on mainnet), stop the guardian vetoing it, or dump the vault deeper than the exit floor without the guardian.",
    },
    {
      who: "The guardian's key alone",
      can: "Pause trading. Veto queued withdrawals, changes and deep exits. Approve a deep exit the owner asked for.",
      cant: "Move funds, start an exit, resume trading, or loosen anything.",
    },
    {
      who: "Owner and guardian together",
      can: "Drain the vault after the timelock, or exit at any price at once.",
      cant: "Nothing. That's why on mainnet both should be multisigs held by different people (not built yet).",
      root: true,
    },
  ];
}

export function WhyNear() {
  const points = [
    {
      title: "Keys that can only do one thing",
      body: "A NEAR function-call access key is limited by the protocol to one contract, chosen methods and a gas budget. The vault installs the agent's key itself: execute() only. On most chains you'd need a smart-contract wallet and a module system to get the same guarantee.",
    },
    {
      title: "Accounts nobody can sign for",
      body: "After setup the vault's only full-access key was deleted. Its funds move only when its code says so, and anyone can confirm that from the chain.",
    },
    {
      title: "Contracts that call DEXes directly",
      body: "The vault writes its own Ref Finance swap and gets the result back in a callback. If Ref refuses or refunds, the vault's daily spend is restored.",
    },
  ];
  return (
    <section className="space-y-10">
      <SectionHead title="Why this needs NEAR" />
      <div className="grid gap-6 md:grid-cols-3">
        {points.map((p) => (
          <div key={p.title} className="space-y-2 border-t-2 border-caution pt-4">
            <h3 className="font-display text-2xl font-extrabold tracking-wide text-ivory">{p.title}</h3>
            <p className="text-sm leading-relaxed text-ivory-dim">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="space-y-5 rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">Mainnet: the contract signs intents through chain signatures</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-ivory-dim">
          On testnet the vault trades on Ref Finance and the guard prices every trade on that same pool. For NEAR Intents
          on mainnet, funds held in <span className="font-mono text-ivory">intents.near</span> move only with a signed
          intent. A key that a server or a person holds would bypass every check above. So the vault won&apos;t hold one.
          The contract checks the intent, then asks NEAR&apos;s chain-signatures MPC network to sign it. No hot key exists
          anywhere.
        </p>
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule text-sm md:grid-cols-5">
          {[
            ["Agent", "Proposes a swap"],
            ["Guard", "Prices it on a live 1Click quote and signs the quote"],
            ["Vault contract", "Runs every check above on the exact intent"],
            ["Chain signatures", "MPC signs that intent for the vault's derived key on intents.near"],
            ["intents.near", "Solver fills it; balances stay under the vault's key"],
          ].map(([who, what], i) => (
            <li key={who} className="space-y-1 bg-panel p-4">
              <span className="font-display text-2xl font-black text-caution">{i + 1}</span>
              <p className="font-semibold text-ivory">{who}</p>
              <p className="text-ivory-dim">{what}</p>
            </li>
          ))}
        </ol>
        <p className="max-w-3xl text-sm text-ivory-dim">
          Status, plainly: this is the design, not shipped code. Today the vault has never touched intents.near. The
          separate $1 swap on the mainnet page uses 1Click from your own wallet, outside the vault.
        </p>
      </div>
    </section>
  );
}

const TESTS = [
  "Swap above the owner's floor executes",
  "Signed swap below the floor is refused",
  "Swap pair without a floor is refused",
  "Swap without a minimum output is refused",
  "Wrapping must be one to one",
  "Tightening applies at once",
  "Loosening waits for the timelock",
  "Loosening can't skip the timelock",
  "Lowering a floor counts as loosening",
  "Key-leak drill: pause, rotate, resume after timelock",
  "Agent trades alone within limits",
  "Over the per-trade cap is refused",
  "Raw token cap holds even if the guard lies about USD value",
  "Forged guard signature is refused",
  "Quote edited after signing is refused",
  "Replayed quote is refused",
  "Many small trades can't pass the daily cap",
  "Unlisted token is refused",
  "Unapproved venue is refused",
  "Fees and price impact above the ceiling are refused",
  "Quote signed for another vault is refused",
  "Expired quote is refused",
  "Above $4 waits for the owner, then executes on approval",
  "Kill switch stops everything",
  "Outside accounts can't execute",
  "Another key on the vault can't execute",
  "Agent can't withdraw",
  "Agent can't change limits",
  "Agent can't replace its own key",
  "Withdrawals wait for the timelock",
  "A withdrawal can't skip the timelock",
  "Stolen owner key: the guardian vetoes the drain",
  "Guardian can't withdraw",
  "Guardian can't resume trading",
  "Guardian can veto a loosening change",
  "Owner can exit to the stablecoin in a crash",
  "Stolen owner key can't dump at a pushed price",
  "With no trade yet, the exit uses the floor",
  "A deep exit needs the guardian",
  "A deep exit can't skip the timelock",
  "Owner can't approve its own deep exit",
  "Guardian can cancel a deep exit",
  "Exit only into an exit token",
  "Agent can't use the crash exit",
  "Agent gas budget is capped",
];

export const TEST_COUNT = TESTS.length;

export function Evidence() {
  const shown = TESTS.slice(0, 9);
  const rest = TESTS.slice(9);
  const Item = ({ t }: { t: string }) => (
    <li className="flex gap-2 text-ivory">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-proceed" />
      {t}
    </li>
  );
  return (
    <div className="space-y-4 rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">The contract&apos;s tests</h3>
        <span className="rounded-full bg-proceed/15 px-3 py-1 font-mono text-sm text-proceed">{TESTS.length} passing</span>
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <Item key={t} t={t} />
        ))}
      </ul>
      <details className="group">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-full border border-rule px-4 text-sm text-ivory hover:border-ivory-dim">
          <span className="group-open:hidden">Show all {TESTS.length}</span>
          <span className="hidden group-open:inline">Show fewer</span>
        </summary>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((t) => (
            <Item key={t} t={t} />
          ))}
        </ul>
      </details>
      <p className="flex flex-wrap gap-x-5 text-sm">
        <a className="text-points underline decoration-points/40 underline-offset-4" href={CONTRACT_SRC}>
          Contract source
        </a>
        <a className="text-points underline decoration-points/40 underline-offset-4" href={CONTRACT_TESTS}>
          Tests
        </a>
        <a className="text-points underline decoration-points/40 underline-offset-4" href={`${REPO}/blob/main/scripts/deploy-testnet.sh`}>
          Deploy script
        </a>
        <a className="text-points underline decoration-points/40 underline-offset-4" href={`${REPO}/blob/main/scripts/key-leak-drill.sh`}>
          Key-leak drill
        </a>
      </p>
    </div>
  );
}

const STATUS: { label: string; tone: string; dot: string; items: string[] }[] = [
  {
    label: "Built and running on testnet",
    tone: "border-proceed/40",
    dot: "bg-proceed",
    items: [
      "GuardVault contract, 45 tests, full-access key deleted",
      "Agent key limited by NEAR to execute() with a gas budget",
      "Guard signatures, price floors, caps, replay and expiry checks",
      "Guardian veto and pause; timelocked withdrawals and loosening",
      "Crash exit with a floor; deeper exits need the guardian",
      "Swaps on Ref Finance written by the contract itself",
      "An LLM agent on NEAR AI Cloud you can hijack",
      "Owner alerts for held trades: badge, webhook, Telegram",
      "One-command deploy of your own vault",
    ],
  },
  {
    label: "Designed, not built",
    tone: "border-caution/40",
    dot: "bg-caution",
    items: [
      "Mainnet: the vault signs NEAR Intents through chain signatures, with no hot key",
      "Price floors relative to an oracle instead of fixed numbers",
    ],
  },
  {
    label: "Not done yet",
    tone: "border-danger/40",
    dot: "bg-danger",
    items: [
      "A vault trade through intents.near (the vault has never touched it)",
      "Owner and guardian as multisigs held by different people",
      "A one-day timelock on mainnet (it's a setting; testnet uses 10 minutes)",
      "Floors re-tuned automatically as the price moves",
    ],
  },
];

export function StatusBoard() {
  return (
    <section className="space-y-10">
      <SectionHead title="What's real, and what isn't yet" lede="So nobody has to guess which parts are running and which are plans." />
      <div className="grid gap-4 lg:grid-cols-3">
        {STATUS.map((c) => (
          <div key={c.label} className={`space-y-4 rounded-[24px] border bg-panel-deep p-5 sm:p-6 ${c.tone}`}>
            <h3 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-wide text-ivory">
              <span className={`h-3 w-3 rounded-full ${c.dot}`} />
              {c.label}
            </h3>
            <ul className="space-y-2 text-sm leading-relaxed text-ivory/90">
              {c.items.map((i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

type Drill = (typeof drills)["guard"];

function DrillCard({ d }: { d: Drill }) {
  return (
    <div className="space-y-4 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
      <div className="space-y-1">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">{d.title}</h3>
        <p className="text-sm text-ivory-dim">
          {d.lede.replace("{vault}", "the vault")}
        </p>
      </div>
      <ol className="divide-y divide-rule/60">
        {d.steps.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-3 py-3">
            <span className="font-display text-2xl font-black leading-none text-caution">{i + 1}</span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="font-semibold text-ivory">{s.title}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                    s.result.startsWith("Refused") ? "bg-danger/15 text-danger" : "bg-proceed/15 text-proceed"
                  }`}
                >
                  {s.result}
                </span>
              </div>
              <p className="text-sm text-ivory-dim">{s.detail}</p>
              {s.tx === "PENDING" ? (
                <span className="font-mono text-xs text-ivory-dim">Waiting for the timelock</span>
              ) : (
                <a
                  href={`${EXPLORER}/txns/${s.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-points underline decoration-points/40 underline-offset-4"
                >
                  {s.tx.slice(0, 10)}… on NearBlocks
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function KeyDrills() {
  return (
    <section className="space-y-10">
      <SectionHead
        title="Stolen keys, rehearsed"
        lede={
          <>
            Both drills ran for real, one after the other, on the same vault as everything else on this page:{" "}
            <span className="font-mono text-ivory">{drills.owner.vault}</span>.
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <DrillCard d={drills.owner as Drill} />
        <DrillCard d={drills.guard} />
      </div>
    </section>
  );
}
