import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { IntegrateSnippet } from "@/components/IntegrateSnippet";
import { DemoBanner } from "@/components/DemoBanner";

export default function DemoPage() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80 mb-2">
            Demo · no wallet · seatbelt still enforced
          </p>
          <h1 className="text-3xl font-bold text-white">IntentRail Demo</h1>
          <p className="mt-2 text-zinc-400 max-w-2xl">
            The seatbelt for AI agents that touch money — proof UI without a wallet.
            Propose a trade, click <strong>Show blocked bad trade</strong> for the video
            BLOCK shot, then try Approve → Dry-quote on a good proposal.
          </p>
        </header>
        <IntegrateSnippet />
        <BacktestPanel />
        <GuardrailPanel />
        <AgentPanel demo />
      </main>
    </>
  );
}
