"use client";

import { fcKeyScope, type NearNetwork } from "@/lib/near-wallet";

export function FunctionCallKeyPanel({ network }: { network: NearNetwork }) {
  const scope = fcKeyScope(network);
  const allowanceNear = (Number(scope.allowance) / 1e24).toFixed(2);

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Trade-only function-call key</h2>
          <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
            When you connect, MyNearWallet can add a{" "}
            <strong className="text-zinc-200">FunctionCallAccessKey</strong> limited to one
            contract and explicit methods — not a full-access key. IntentRail never generates
            or stores private keys server-side; your wallet signs.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold text-violet-200">
          DAY 2
        </span>
      </div>

      <dl className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-xl bg-black/35 px-3 py-2">
          <dt className="text-[11px] text-zinc-500">Contract</dt>
          <dd className="font-mono text-violet-200 text-xs break-all mt-0.5">
            {scope.contractId}
          </dd>
        </div>
        <div className="rounded-xl bg-black/35 px-3 py-2">
          <dt className="text-[11px] text-zinc-500">Methods</dt>
          <dd className="font-mono text-zinc-200 text-xs mt-0.5">
            {scope.methodNames.join(", ")}
          </dd>
        </div>
        <div className="rounded-xl bg-black/35 px-3 py-2">
          <dt className="text-[11px] text-zinc-500">Allowance</dt>
          <dd className="font-mono text-zinc-200 text-xs mt-0.5">~{allowanceNear} NEAR</dd>
        </div>
      </dl>

      {network === "testnet" ? (
        <p className="text-[11px] text-amber-200/90">
          App network is <span className="font-mono">testnet</span>. Intents verifier{" "}
          <span className="font-mono">intents.near</span> is mainnet-only (HACKATHON Q-007), so
          the testnet key targets <span className="font-mono">wrap.testnet</span> with deposit /
          withdraw methods only (still no arbitrary calls). Enable mainnet dual flag to scope
          keys to <span className="font-mono">intents.near</span> →{" "}
          <span className="font-mono">execute_intents</span>,{" "}
          <span className="font-mono">simulate_intents</span>.
        </p>
      ) : (
        <p className="text-[11px] text-emerald-200/90">
          Mainnet: key scoped to <span className="font-mono">intents.near</span> trade methods
          only. Execution still requires human approval + wallet sign.
        </p>
      )}

      <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400 space-y-1">
        <p className="font-medium text-zinc-300">Revoke</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Open{" "}
            <a
              className="text-sky-400 hover:underline"
              href={
                network === "mainnet"
                  ? "https://app.mynearwallet.com"
                  : "https://testnet.mynearwallet.com"
              }
              target="_blank"
              rel="noreferrer"
            >
              MyNearWallet
            </a>{" "}
            → Security / Keys
          </li>
          <li>
            Find the function-call key for{" "}
            <span className="font-mono text-zinc-300">{scope.contractId}</span>
          </li>
          <li>Delete / revoke that key (full-access key stays with you)</li>
        </ol>
      </div>
    </section>
  );
}
