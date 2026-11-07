"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { GuardResult, PriceSnapshot, TradeProposal } from "@/lib/types";

export type FeedItem = {
  proposal: TradeProposal;
  guard: GuardResult;
  approved: boolean;
};

export type LivePayload = {
  ok: boolean;
  live: boolean;
  degraded: boolean;
  cached: boolean;
  asOf: string;
  network: string;
  prices: PriceSnapshot[];
  policy: {
    killSwitch: boolean;
    maxLossPerTradeUsd: number;
    dailySpendCapUsd: number;
    maxSlippageBps: number;
    requireHumanApproval: boolean;
    allowlistedSymbols: string[];
  };
  hardCaps?: {
    maxTradeUsd: number;
    minTradeUsd: number;
    maxMainnetSwapUsd: number;
    maxMainnetWalletDailyUsd: number;
  };
  spentUsdToday: number;
  feed: FeedItem[];
  refreshHintSec: number;
  error?: string;
};

type Ctx = {
  data: LivePayload | null;
  error: string | null;
  refresh: () => Promise<LivePayload | null>;
};

const LiveCtx = createContext<Ctx | null>(null);

/** One shared poller for /api/live so the board, rule book and signal box agree. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/live?t=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json()) as LivePayload;
      if (!res.ok || !json.ok) {
        setError(json.error || "Live feed unavailable");
        return null;
      }
      setData(json);
      setError(null);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(() => ({ data, error, refresh }), [data, error, refresh]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export function useLive() {
  const ctx = useContext(LiveCtx);
  if (!ctx) throw new Error("useLive must be used inside LiveProvider");
  return ctx;
}
