import type { BacktestResult } from "@/lib/types";
import { CONTRACT_SRC, CONTRACT_TESTS, REPO } from "./format";

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
    body: "Pair and size only. Anything it says about its own fees, stop-loss or confidence is ignored.",
  },
  {
    who: "Guard server",
    title: "Prices it and signs it",
    body: "Live CoinGecko price and a live NEAR Intents 1Click quote. It measures fees, price impact and worst-case loss, runs its own trend and risk agents, and signs a quote bound to this vault, single-use, valid for two minutes.",
  },
  {
    who: "GuardVault contract",
    title: "Checks its own limits",
    body: "Signature, freshness, replay, token and venue allowlists, per-trade cap in USD and in raw tokens, daily cap, fee ceiling, kill switch. Above $4 it waits for the owner.",
  },
  {
    who: "Venue",
    title: "Trade settles back to the vault",
    body: "No trade shape has a recipient field, so output can only return to the vault. Testnet: wrap.testnet. Mainnet: intents.near.",
  },
];

export function HowItWorks() {
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
                "Send execute() calls and spend its 0.5 NEAR gas budget",
                "Transfer, add keys, delete the account, or call another contract. NEAR's protocol refuses.",
              ],
              [
                "The guard server and its key",
                "Sign bad quotes",
                "Pass the contract's caps, allowlists, daily limit or owner approval. A $50 quote is refused even with a valid signature.",
              ],
              ["The owner's key", "Change limits and withdraw", "Nothing is stopped. The owner is the human in charge."],
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
      title: "One vault, any chain's liquidity",
      body: "NEAR Intents lets the vault deposit into intents.near and settle swaps through solvers across chains. The guard already prices every trade against live 1Click solver quotes. Pointing the vault at intents.near is a policy change, not new code.",
    },
    {
      title: "Accounts that can't be signed for",
      body: "After setup the vault's only full-access key was deleted. Its funds can move only when its code says so, and anyone can confirm that from the chain.",
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
      <p className="max-w-3xl text-sm text-ivory-dim">
        Scope, plainly: the vault runs on testnet and trades NEAR and wNEAR through wrap.testnet, because NEAR Intents
        runs on mainnet only. The guard&apos;s pricing uses live mainnet quotes. The $1 mainnet swap further down uses
        1Click directly, signed in your own wallet.
      </p>
    </section>
  );
}

const TESTS = [
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
];

export function Evidence({ backtest }: { backtest: BacktestResult | null }) {
  const bt = backtest && backtest.source === "coingecko" ? backtest : null;
  const pct = (n: number | null) => (n === null ? "n/a" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
  return (
    <section className="space-y-10">
      <SectionHead title="Evidence" lede="Everything here can be checked: the code, the tests, and the chain." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-[24px] border border-rule bg-panel-deep p-5 sm:p-7">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-3xl font-black tracking-wide text-ivory">Contract tests</h3>
            <span className="font-mono text-proceed">{TESTS.length} passing</span>
          </div>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
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
          </p>
        </div>

        <div className="space-y-4 rounded-[24px] border border-rule bg-panel-raised p-5 sm:p-7">
          <h3 className="font-display text-3xl font-black tracking-wide text-ivory">The agent&apos;s strategy, backtested</h3>
          <p className="text-sm text-ivory-dim">
            NEAR, last {bt?.days ?? 30} days of CoinGecko daily prices, {bt?.feeBpsAssumed ?? 20} bps fees per trade. A
            backtest, not a promise.
          </p>
          {bt ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ["After fees", pct(bt.pnlAfterFeesPct)],
                ["Buy and hold", pct(bt.buyAndHoldPct)],
                ["Difference", pct(bt.vsBuyAndHoldPct)],
                ["Trades", String(bt.trades)],
                ["Win rate", bt.winRatePct === null ? "n/a" : `${bt.winRatePct.toFixed(0)}%`],
                ["Worst drawdown", bt.maxDrawdownPct === null ? "n/a" : `${bt.maxDrawdownPct.toFixed(2)}%`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm text-ivory-dim">{k}</dt>
                  <dd className="font-mono text-2xl text-ivory">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-caution">
              Historical prices weren&apos;t available when this page was built. Reload to try again.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
