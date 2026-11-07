import { readFile } from "fs/promises";
import path from "path";
import { SeatbeltPlayground } from "@/components/SeatbeltPlayground";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const md = await readFile(path.join(process.cwd(), "SECURITY.md"), "utf8");
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-10 overflow-x-hidden">
      <header className="space-y-4">
        <h1 className="font-display font-black leading-[0.9] tracking-wide text-ivory text-[clamp(3rem,7vw,6rem)]">Guard API</h1>
        <p className="text-lg text-ivory-dim max-w-[52ch] leading-relaxed">
          A preflight check for any agent. Send the pair and size; the guard prices the trade
          from a live NEAR Intents quote and computes every number itself. Funds held in a
          GuardVault only move when the contract agrees too.
        </p>
        <p className="text-sm">
          <a className="text-points underline decoration-points/40 underline-offset-4 min-h-11 inline-flex items-center" href="/api/guard/check">
            See the usage JSON for GET /api/guard/check
          </a>
        </p>
      </header>

      <SeatbeltPlayground />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5 overflow-hidden">
        <h2 className="text-sm font-semibold text-white mb-3">Security model</h2>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] sm:text-sm text-zinc-300 leading-relaxed overflow-x-auto">
          {md}
        </pre>
      </section>
    </main>
  );
}
