import { getTokenBySymbol } from "./tokens";
import type { BacktestResult, BacktestTrade } from "./types";

const FEE_BPS = 20;
const EDGE_BPS_MIN = 35;

/**
 * Simple fee-aware trend backtest on CoinGecko daily prices.
 * Not a guarantee — labeled clearly. Never fabricates series when API fails.
 */
export async function runBacktest(opts?: {
  symbol?: string;
  days?: number;
}): Promise<BacktestResult> {
  const symbol = (opts?.symbol || "NEAR").toUpperCase();
  const days = Math.min(90, Math.max(14, opts?.days ?? 30));
  const token = getTokenBySymbol(symbol);
  const disclaimer =
    "Backtest on historical CoinGecko prices — not a guarantee of future results.";

  const base: BacktestResult = {
    symbol,
    days,
    source: "unavailable",
    feeBpsAssumed: FEE_BPS,
    trades: 0,
    winRatePct: null,
    pnlAfterFeesPct: null,
    maxDrawdownPct: null,
    buyAndHoldPct: null,
    vsBuyAndHoldPct: null,
    label: "backtest, not a guarantee",
    disclaimer,
    points: 0,
    sampleTrades: [],
  };

  if (!token || token.symbol === "USDC") {
    return { ...base, disclaimer: "Pick a non-stable allowlisted symbol." };
  }

  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(token.coingeckoId)}` +
      `/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ...base, disclaimer: `${disclaimer} (CoinGecko ${res.status})` };
    }
    const data = (await res.json()) as { prices?: [number, number][] };
    const prices = data.prices || [];
    if (prices.length < 10) {
      return { ...base, disclaimer: `${disclaimer} (insufficient points)` };
    }

    // Resample to ~1 point/day
    const byDay = new Map<string, number>();
    for (const [ts, px] of prices) {
      const day = new Date(ts).toISOString().slice(0, 10);
      byDay.set(day, px);
    }
    const series = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, px]) => ({ day, px }));

    if (series.length < 5) {
      return { ...base, points: series.length };
    }

    const start = series[0].px;
    const end = series[series.length - 1].px;
    const buyAndHoldPct = ((end - start) / start) * 100;

    let cash = 1; // normalized
    let position = 0;
    let entry = 0;
    const trades: BacktestTrade[] = [];
    let equityPeak = 1;
    let maxDd = 0;
    const equityCurve: number[] = [];

    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].px;
      const cur = series[i].px;
      const changePct = ((cur - prev) / prev) * 100;
      const edgeBps = Math.min(200, Math.abs(changePct) * 10);
      const mark = position > 0 ? (position * cur) / entry : cash;
      equityPeak = Math.max(equityPeak, mark);
      maxDd = Math.max(maxDd, ((equityPeak - mark) / equityPeak) * 100);
      equityCurve.push(mark);

      // Exit if in position at end of day move opposite or flat
      if (position > 0 && changePct < -0.5) {
        const raw = (position * cur) / entry;
        const afterFee = raw * (1 - FEE_BPS / 10_000);
        const pnlPct = (afterFee - 1) * 100;
        trades.push({
          at: series[i].day,
          side: "buy",
          priceUsd: cur,
          edgeBps,
          feeBps: FEE_BPS,
          pnlPct: Number(pnlPct.toFixed(3)),
          win: afterFee > 1,
        });
        cash = afterFee;
        position = 0;
        entry = 0;
        continue;
      }

      // Enter on uptrend day when edge > fee
      if (position === 0 && changePct > 1.0 && edgeBps > FEE_BPS + (EDGE_BPS_MIN - FEE_BPS) / 2) {
        const afterFee = cash * (1 - FEE_BPS / 10_000);
        position = afterFee;
        entry = cur;
        cash = 0;
      }
    }

    // Close open position at end
    if (position > 0) {
      const cur = series[series.length - 1].px;
      const raw = (position * cur) / entry;
      const afterFee = raw * (1 - FEE_BPS / 10_000);
      trades.push({
        at: series[series.length - 1].day,
        side: "buy",
        priceUsd: cur,
        edgeBps: 0,
        feeBps: FEE_BPS,
        pnlPct: Number(((afterFee - 1) * 100).toFixed(3)),
        win: afterFee > 1,
      });
      cash = afterFee;
      position = 0;
    }

    const finalEquity = cash;
    const pnlAfterFeesPct = (finalEquity - 1) * 100;
    const wins = trades.filter((t) => t.win).length;
    const winRatePct = trades.length ? (wins / trades.length) * 100 : null;

    return {
      symbol,
      days,
      source: "coingecko",
      feeBpsAssumed: FEE_BPS,
      trades: trades.length,
      winRatePct: winRatePct === null ? null : Number(winRatePct.toFixed(1)),
      pnlAfterFeesPct: Number(pnlAfterFeesPct.toFixed(2)),
      maxDrawdownPct: Number(maxDd.toFixed(2)),
      buyAndHoldPct: Number(buyAndHoldPct.toFixed(2)),
      vsBuyAndHoldPct: Number((pnlAfterFeesPct - buyAndHoldPct).toFixed(2)),
      label: "backtest, not a guarantee",
      disclaimer,
      points: series.length,
      sampleTrades: trades.slice(-5),
    };
  } catch {
    return { ...base, disclaimer: `${disclaimer} (fetch failed)` };
  }
}
