"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLive } from "./LiveContext";

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** One split-flap tile. Flips only when its character changes. */
function Flap({ ch, tone }: { ch: string; tone: string }) {
  const reduce = useReducedMotion();
  return (
    <span
      className="relative inline-flex h-[1.45em] w-[0.7em] items-center justify-center overflow-hidden rounded-[3px] bg-[#0a1415] [perspective:300px]"
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-black/70" />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ch}
          className={`block ${tone}`}
          initial={reduce ? false : { rotateX: -90, opacity: 0.2 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={reduce ? undefined : { rotateX: 90, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeIn" }}
          style={{ transformOrigin: "50% 50%" }}
        >
          {ch === " " ? " " : ch}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function FlapText({ text, width, tone = "text-ivory" }: { text: string; width: number; tone?: string }) {
  const padded = text.padStart(width, " ").slice(-width);
  return (
    <span className="inline-flex gap-px" aria-label={text}>
      {padded.split("").map((c, i) => (
        <Flap key={i} ch={c} tone={tone} />
      ))}
    </span>
  );
}

export function DepartureBoard() {
  const { data, error } = useLive();
  const prices = data?.prices ?? [];
  const status = !data ? "Connecting" : data.live ? "Live" : data.degraded ? "Fallback prices" : "Delayed";
  const updated = data?.asOf
    ? new Date(data.asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--:--:--";

  return (
    <section className="rounded-[28px] border border-rule bg-panel-deep p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl font-black tracking-wide text-ivory">Market board</h2>
        <p className="text-sm text-ivory-dim">
          <span
            className={`mr-2 inline-block h-2 w-2 rounded-full ${
              data?.live ? "bg-proceed" : "bg-caution"
            }`}
          />
          {status}, updated {updated}. Prices from CoinGecko, refreshed every 15 seconds.
        </p>
      </div>
      {error && (
        <p className="mt-3 text-sm text-caution">
          The price feed didn&apos;t answer ({error}). The board keeps the last prices it had.
        </p>
      )}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[330px] font-mono text-base sm:text-xl">
          <thead>
            <tr className="text-left font-sans text-sm text-ivory-dim">
              <th className="pb-3 font-normal">Asset</th>
              <th className="pb-3 text-right font-normal">Price (USD)</th>
              <th className="pb-3 text-right font-normal">24 hours</th>
            </tr>
          </thead>
          <tbody>
            {(prices.length ? prices : ["NEAR", "USDC", "BTC", "ETH"].map((s) => ({ symbol: s, priceUsd: NaN, change24hPct: NaN }))).map(
              (p) => {
                const up = p.change24hPct >= 0;
                const change = Number.isFinite(p.change24hPct)
                  ? `${up ? "+" : "-"}${Math.abs(p.change24hPct).toFixed(2)}%`
                  : "--.--%";
                return (
                  <tr key={p.symbol} className="border-t border-rule/70">
                    <td className="py-2.5">
                      <FlapText text={p.symbol} width={4} tone="text-caution" />
                    </td>
                    <td className="py-2.5 text-right">
                      <FlapText text={Number.isFinite(p.priceUsd) ? formatPrice(p.priceUsd) : "-----"} width={8} />
                    </td>
                    <td className="py-2.5 text-right">
                      <FlapText
                        text={change}
                        width={7}
                        tone={!Number.isFinite(p.change24hPct) ? "text-ivory-dim" : up ? "text-proceed" : "text-danger"}
                      />
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RuleBook() {
  const { data } = useLive();
  const p = data?.policy;
  const caps = data?.hardCaps;
  const spent = data?.spentUsdToday ?? 0;
  const cap = p?.dailySpendCapUsd ?? 0;
  const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;

  const rows: { rule: string; value: string; note?: string }[] = [
    {
      rule: "Kill switch",
      value: p ? (p.killSwitch ? "On, all trading stopped" : "Off") : "…",
    },
    {
      rule: "Trade size",
      value: caps ? `$${caps.minTradeUsd} to $${caps.maxTradeUsd}` : "…",
    },
    { rule: "Loss per trade", value: p ? `Up to $${p.maxLossPerTradeUsd}` : "…" },
    { rule: "Slippage", value: p ? `Up to ${p.maxSlippageBps} bps` : "…" },
    {
      rule: "Tokens",
      value: p ? p.allowlistedSymbols.join(", ") : "…",
      note: "Anything else is blocked.",
    },
    {
      rule: "Real mainnet swaps",
      value: caps ? `$${caps.maxMainnetSwapUsd} each, $${caps.maxMainnetWalletDailyUsd} per wallet a day` : "…",
    },
    {
      rule: "Signing",
      value: p?.requireHumanApproval === false ? "Optional" : "A person signs every trade",
      note: "The server never holds keys.",
    },
  ];

  return (
    <section className="rounded-[28px] border border-rule bg-panel-raised p-5 sm:p-7 space-y-6">
      <div>
        <h2 className="font-display text-3xl font-black tracking-wide text-ivory">The rule book</h2>
        <p className="mt-1 max-w-xl text-sm text-ivory-dim">
          The limits every signal enforces right now, read from the running server.
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-ivory">Spent today</span>
          <span className="font-mono text-ivory">
            ${spent.toFixed(2)} <span className="text-ivory-dim">of ${cap || "…"}</span>
          </span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-panel-deep">
          <motion.div
            className="h-full rounded-full bg-caution"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(pct, spent > 0 ? 2 : 0)}%` }}
            transition={{ duration: 0.8, ease: [0.3, 0, 0.2, 1] }}
          />
        </div>
      </div>

      <dl className="divide-y divide-rule/70">
        {rows.map((r) => (
          <div key={r.rule} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
            <dt className="text-sm text-ivory-dim">{r.rule}</dt>
            <dd className="text-base text-ivory">
              {r.value}
              {r.note && <span className="ml-2 text-sm text-ivory-dim">{r.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
