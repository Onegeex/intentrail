import { HomeClient } from "@/components/HomeClient";
import type { RecordedLlm } from "@/components/vault/AgentChat";
import type { AttackRun } from "@/components/vault/AttackDemo";
import { Evidence, HowItWorks, KeyDrills, StatusBoard, TEST_COUNT, WhyNear, type WorstCase } from "@/components/vault/Sections";
import recorded from "@/data/recorded-attack.json";
import recordedLlm from "@/data/recorded-llm.json";
import { llmConfigured } from "@/lib/llm-agent";
import { VAULT_OWNER_ID, getVaultSnapshot, type VaultSnapshot } from "@/lib/vault";
import { worstCaseIfGuardHacked } from "@/lib/vault-agent";

export const dynamic = "force-dynamic";

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

export default async function HomePage() {
  const [vault, worstCase] = await Promise.all([
    withTimeout<VaultSnapshot>(getVaultSnapshot(), 6_000),
    withTimeout<NonNullable<WorstCase>>(worstCaseIfGuardHacked(), 6_000),
  ]);
  return (
    <HomeClient
      vault={vault}
      worstCase={worstCase}
      ownerId={VAULT_OWNER_ID}
      recordedAttack={recorded as AttackRun}
      recordedLlm={recordedLlm as RecordedLlm}
      howItWorks={<HowItWorks worstCase={worstCase} />}
      tests={<Evidence />}
      testCount={TEST_COUNT}
      drills={<KeyDrills />}
      status={<StatusBoard />}
      whyNear={<WhyNear />}
      llmConfigured={llmConfigured()}
    />
  );
}
