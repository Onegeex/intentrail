import { HomeClient } from "@/components/HomeClient";
import type { AttackRun } from "@/components/vault/AttackDemo";
import { Evidence, HowItWorks, WhyNear } from "@/components/vault/Sections";
import recorded from "@/data/recorded-attack.json";
import { runBacktest } from "@/lib/backtest";
import { isMainnetLiveAllowed } from "@/lib/config";
import type { BacktestResult } from "@/lib/types";
import { VAULT_OWNER_ID, getVaultSnapshot, type VaultSnapshot } from "@/lib/vault";

export const dynamic = "force-dynamic";

let backtestCache: { at: number; data: BacktestResult } | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

async function getBacktest(): Promise<BacktestResult | null> {
  if (backtestCache && Date.now() - backtestCache.at < 30 * 60_000) return backtestCache.data;
  const data = await withTimeout(runBacktest({ symbol: "NEAR", days: 30 }), 6_000);
  if (data && data.source === "coingecko") backtestCache = { at: Date.now(), data };
  return data;
}

export default async function HomePage() {
  const [vault, backtest] = await Promise.all([
    withTimeout<VaultSnapshot>(getVaultSnapshot(), 6_000),
    getBacktest(),
  ]);
  return (
    <HomeClient
      mainnetLiveAllowed={isMainnetLiveAllowed()}
      vault={vault}
      ownerId={VAULT_OWNER_ID}
      recordedAttack={recorded as AttackRun}
      howItWorks={<HowItWorks />}
      whyNear={<WhyNear />}
      evidence={<Evidence backtest={backtest} />}
    />
  );
}
