import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { IntegrateSnippet } from "@/components/IntegrateSnippet";
import { DemoBanner } from "@/components/DemoBanner";
import { SeatbeltPlayground } from "@/components/SeatbeltPlayground";
import Link from "next/link";

export default function DemoPage() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8 space-y-6 sm:space-y-8 overflow-x-hidden">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">
            Demo · no wallet · seatbelt still enforced
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Try the demo</h1>
          <p className="text-sm sm:text-base text-zinc-400 max-w-2xl">
            Propose a trade, see the seatbelt block a bad one, then dry-quote a good proposal —
            all without connecting a wallet.
          </p>
          <Link href="/security" className="inline-flex min-h-11 items-center text-sm text-sky-400 hover:underline">
            Seatbelt playground →
          </Link>
        </header>
        <SeatbeltPlayground />
        <IntegrateSnippet />
        <BacktestPanel />
        <GuardrailPanel />
        <AgentPanel demo />
      </main>
    </>
  );
}
