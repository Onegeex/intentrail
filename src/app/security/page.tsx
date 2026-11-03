import Link from "next/link";
import { readFile } from "fs/promises";
import path from "path";

export default async function SecurityPage() {
  const md = await readFile(path.join(process.cwd(), "SECURITY.md"), "utf8");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-sky-400 hover:underline">
        ← IntentRail
      </Link>
      <pre className="mt-6 whitespace-pre-wrap font-mono text-sm text-zinc-300 leading-relaxed">
        {md}
      </pre>
    </main>
  );
}
