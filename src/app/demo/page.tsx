import { AgentPanel } from "@/components/AgentPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { DemoBanner } from "@/components/DemoBanner";

export default function DemoPage() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80 mb-2">
            Demo · no wallet · guardrails still enforced
          </p>
          <h1 className="text-3xl font-bold text-white">IntentRail Demo</h1>
          <p className="mt-2 text-zinc-400 max-w-2xl">
            Judges: open this page, click <strong>Propose trade</strong>, read the
            PASS/BLOCK panel, toggle the kill switch, then Approve → Dry-quote.
            No keys needed.
          </p>
        </header>
        <GuardrailPanel />
        <AgentPanel demo />
      </main>
    </>
  );
}
