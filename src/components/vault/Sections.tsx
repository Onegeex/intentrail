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

      <div className="overflow-x-auto">
        {worstCase && (
          <p className="mb-6 max-w-3xl rounded-2xl border border-caution/40 bg-caution/10 p-4 text-ivory">
            <span className="font-semibold">Worst case if our guard server is hacked:</span> it can sign trades right at the
            owner&apos;s price floor, {worstCase.worstGapPct}% under today&apos;s pool price, up to ${worstCase.autonomousMaxUsd} a
            trade without the owner. That&apos;s about <span className="font-semibold">${worstCase.perTradeUsd.toFixed(2)} a trade and $
            {worstCase.perDayUsd.toFixed(2)} a day</span> on a ${worstCase.dailyCapUsd} daily cap, until the owner or guardian pauses.
            Tighter floors or a lower cap shrink it.
          </p>
        )}
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-ivory-dim">
              <th className="pb-3 pr-4 font-normal">If this is compromised</th>
              <th className="pb-3 pr-4 font-normal">The attacker can</th>
              <th className="pb-3 font-normal">The attacker can&apos;t</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/70 align-top">
            {[
              [
                "The agent, or its prompt",
                "Ask for trades",
                "Edit a signed quote, replay one, call any method but execute(), touch tokens directly, or exceed any limit",
              ],
              [
                "The agent's key",
                "Send execute() calls and spend its gas budget. Without a guard signature they all fail.",
                "Transfer, add keys, delete the account, or call another contract. NEAR's protocol refuses.",
              ],
              [
                "The guard server and its key",
                worstCase
                  ? `Sign bad-but-allowed trades until someone notices: at most about $${worstCase.perTradeUsd.toFixed(2)} a trade and $${worstCase.perDayUsd.toFixed(2)} a day at today's pool prices`
                  : "Sign bad-but-allowed trades until someone notices, down to the owner's price floor",
                "Sell below the owner's floor, exceed any cap, add a venue, or skip owner approval. Once the owner rotates the key, its quotes are worthless.",
              ],
              ["Anyone else", "Read the vault", "Call execute(), even with a genuine signed quote. Only the agent key or the owner may."],
              [
                "The owner's key alone",
                "Queue a withdrawal to the owner account, which the attacker now controls. Queue looser limits. Swap into the stablecoin at once, at a bad price if it wants, but the funds stay in the vault.",
                "Take anything out before the timelock (10 minutes on testnet; a day on mainnet), or stop the guardian vetoing it",
              ],
              ["The guardian's key alone", "Pause trading, veto queued withdrawals and changes", "Move funds, resume trading, or loosen anything"],
              [
                "Owner and guardian together",
                "Drain the vault after the timelock. This is the trust root.",
                "Nothing. On mainnet both should be multisig accounts held by different people.",
              ],
            ].map(([who, can, cant]) => (
              <tr key={who}>
                <td className="py-3 pr-4 text-ivory">{who}</td>
                <td className="py-3 pr-4 text-ivory-dim">{can}</td>
                <td className="py-3 text-ivory">{cant}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
  "Exit only into an exit token",
  "Agent can't use the crash exit",
  "Agent gas budget is capped",
];

export function Evidence() {
  return (
    <div className="space-y-4 rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">The contract&apos;s tests</h3>
        <span className="font-mono text-proceed">{TESTS.length} passing</span>
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {TESTS.map((t) => (
          <li key={t} className="flex gap-2 text-ivory">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-proceed" />
            {t}
          </li>
        ))}
      </ul>
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

type Drill = (typeof drills)["guard"];

function DrillCard({ d }: { d: Drill }) {
  return (
    <div className="space-y-4 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
      <div className="space-y-1">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">{d.title}</h3>
        <p className="text-sm text-ivory-dim">
          {d.lede.split("{vault}")[0]}
          <span className="font-mono">{d.vault}</span>
          {d.lede.split("{vault}")[1]}
        </p>
      </div>
      <ol className="divide-y divide-rule/60">
        {d.steps.map((s, i) => (
          <li key={s.tx} className="grid gap-1 py-3 sm:grid-cols-[2rem_1fr_auto] sm:items-baseline sm:gap-4">
            <span className="font-display text-2xl font-black text-caution">{i + 1}</span>
            <div>
              <p className="font-semibold text-ivory">{s.title}</p>
              <p className="text-sm text-ivory-dim">{s.detail}</p>
              <a
                href={`${EXPLORER}/txns/${s.tx}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-points underline decoration-points/40 underline-offset-4"
              >
                {s.tx.slice(0, 10)}… on NearBlocks
              </a>
            </div>
            <span className={`justify-self-start font-mono text-sm ${s.result.startsWith("Refused") ? "text-danger" : "text-proceed"}`}>{s.result}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function KeyDrills() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DrillCard d={drills.owner as Drill} />
      <DrillCard d={drills.guard} />
    </div>
  );
}
