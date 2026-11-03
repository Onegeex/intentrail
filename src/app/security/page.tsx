import Link from "next/link";
import { readFile } from "fs/promises";
import path from "path";
import { SeatbeltPlayground } from "@/components/SeatbeltPlayground";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const md = await readFile(path.join(process.cwd(), "SECURITY.md"), "utf8");
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10 space-y-8 overflow-x-hidden">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-violet-300/80">
          Security · seatbelt API
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Security & seatbelt</h1>
        <p className="text-sm text-zinc-400 max-w-xl">
          Exercise the same fail-closed engine external agents call. Presets cover allowed and
          blocked paths. Full model notes below.
        </p>
        <p className="text-sm">
          <Link className="text-sky-400 hover:underline min-h-11 inline-flex items-center" href="/">
            ← Home
          </Link>
          {" · "}
          <a className="text-sky-400 hover:underline" href="/api/guard/check">
            GET /api/guard/check (usage JSON)
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
