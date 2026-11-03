import Link from "next/link";
import { AgentPanel } from "@/components/AgentPanel";
import { GuardrailPanel } from "@/components/GuardrailPanel";
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
            NEAR HACKATHON · defi · security · agents
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            IntentRail
          </h1>
          <p className="mt-2 text-zinc-400 max-w-xl">
            Live AI trading agent on{" "}
            <strong className="text-zinc-200">NEAR Intents</strong> — fee-aware
            proposals, fail-closed guardrails, human approval before every sign.
            Testnet by default. No private keys.
          </p>
          <p className="mt-3 text-sm">
            <Link className="text-sky-400 hover:underline" href="/demo">
              Demo mode (no wallet)
            </Link>
            {" · "}
            <Link className="text-sky-400 hover:underline" href="/security">
              Security model
            </Link>
          </p>
        </div>
        <WalletConnect network={network} />
      </header>

      <LiveDashboard />

      <FunctionCallKeyPanel network={network} />

      <div className="grid lg:grid-cols-1 gap-6">
        <GuardrailPanel />
        <AgentPanel demo={false} />
      </div>

      <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-500 space-y-1">
        <p>
          Testnet by default. Mainnet only when{" "}
          <code className="text-zinc-400">NEAR_NETWORK=mainnet</code> and{" "}
          <code className="text-zinc-400">ALLOW_MAINNET=true</code>.
        </p>
        <p>
          No private keys or seed phrases. Signing is wallet-only. See SECURITY.md.
        </p>
      </footer>
    </main>
  );
}
