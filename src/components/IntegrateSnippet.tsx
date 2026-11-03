export function IntegrateSnippet() {
  const snippet = `const res = await fetch("https://intentrail-neon.vercel.app/api/guard/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 5,
    slippageBps: 50, stopLossPct: 2, feeAwareOk: true,
    votes: [
      { agent: "trend", vote: "yes", reason: "up" },
      { agent: "risk", vote: "yes", reason: "sized" },
    ],
  }),
});
const { decision, reason, checks } = await res.json(); // PASS | BLOCK`;

  return (
    <section className="rounded-2xl border border-violet-900/50 bg-violet-950/20 p-5 space-y-3">
      <h2 className="text-base font-semibold text-white">
        Seatbelt API — integrate in ~5 lines
      </h2>
      <p className="text-sm text-zinc-400">
        Primary audience: <strong className="text-zinc-200">agent builders</strong>. Drop{" "}
        <code className="text-violet-300">POST /api/guard/check</code> in front of any agent that
        touches money. Fail-closed. Reuses the same engine as the trader proof UI below.
      </p>
      <pre className="overflow-x-auto rounded-xl bg-black/60 border border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-300 font-mono whitespace-pre">
        {snippet}
      </pre>
    </section>
  );
}
