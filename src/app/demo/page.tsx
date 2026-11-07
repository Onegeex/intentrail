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
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14 space-y-8 sm:space-y-10 overflow-x-hidden">
        <header className="space-y-4">
          <h1 className="font-display font-black leading-[0.9] tracking-wide text-ivory text-[clamp(3rem,7vw,6rem)]">Try the demo</h1>
          <p className="text-lg text-ivory-dim max-w-[52ch] leading-relaxed">
            Propose a trade, watch the seatbelt block a bad one, then get a dry-run quote for a
            good one. No wallet needed, and every check still runs.
          </p>
          <Link href="/security" className="inline-flex min-h-11 items-center text-base font-semibold text-points underline decoration-points/40 underline-offset-4">
            Open the API playground
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
