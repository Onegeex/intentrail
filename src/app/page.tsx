import Link from "next/link";
import { AgentPanel } from "@/components/AgentPanel";
import { BacktestPanel } from "@/components/BacktestPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
import { IntegrateSnippet } from "@/components/IntegrateSnippet";
import { LiveDashboard } from "@/components/LiveDashboard";
import { FunctionCallKeyPanel } from "@/components/FunctionCallKeyPanel";
import { WalletConnect } from "@/components/WalletConnect";
import { resolveNetwork } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const network = resolveNetwork();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/80 mb-2">
            NEAR HACKATHON · seatbelt for agents · defi · security
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            IntentRail
          </h1>
          <p className="mt-2 text-lg text-zinc-200 max-w-xl font-medium">
            The seatbelt for AI agents that touch money.
          </p>
          <p className="mt-2 text-zinc-400 max-w-xl text-sm">
            Built for <strong className="text-zinc-200">agent builders</strong> who need
            fail-closed guardrails before any sign. The trader/farmer flow below is the{" "}
            <em>proof</em> — multi-agent consensus in, PASS/BLOCK out, optional $1 mainnet path
            you opt into yourself. Testnet by default. No private keys on the server.
          </p>
          <p className="mt-3 text-sm">
            <Link className="text-sky-400 hover:underline" href="/demo">
              Demo mode (no wallet)
            </Link>
            {" · "}
            <Link className="text-sky-400 hover:underline" href="/security">
              Security model
            </Link>
            {" · "}
            <a className="text-sky-400 hover:underline" href="/api/guard/check">
              Guard API
            </a>
          </p>
        </div>
        <WalletConnect network={network} />
      </header>

      <IntegrateSnippet />

      <LiveDashboard />

      <BacktestPanel />

      <FunctionCallKeyPanel network={network} />

      <div className="grid lg:grid-cols-1 gap-6">
        <GuardrailPanel />
        <AgentPanel demo={false} network={network} />
      </div>

      <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-500 space-y-1">
        <p>
          Public demo stays on testnet. Real ≤$1 swaps only when{" "}
          <code className="text-zinc-400">NEAR_NETWORK=mainnet</code> and{" "}
          <code className="text-zinc-400">ALLOW_MAINNET=true</code> on <em>your</em> machine —
          IntentRail does not flip those flags on Vercel.
        </p>
        <p>
          No private keys or seed phrases. Signing is wallet-only. See SECURITY.md.
        </p>
      </footer>
    </main>
  );
}
