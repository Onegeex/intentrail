# IntentRail

**The seatbelt for AI agents that touch money.**

Primary audience: **agent builders**. The trader/farmer UI is the proof that the seatbelt works on a real NEAR Intents path.

Built for [NEAR HACKATHON](https://nearhackathon.com).

## Tracks

| Track | Fit |
| --- | --- |
| `security` | Fail-closed guardrail engine + kill switch + trade-only FC keys |
| `defi` | NEAR Intents / 1Click dry quotes + opt-in ≤$1 executable path |
| `agents` | Guardrailed agent spending (simulated micro-budget) |
| `swarms` | Multi-agent consensus (Trend + Risk) feeding the guardrail |

## Seatbelt API (builders)

```js
const res = await fetch("https://intentrail-neon.vercel.app/api/guard/check", {
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
const { decision, reason, checks } = await res.json(); // PASS | BLOCK
```

Engine module: `src/lib/guardrails.ts` (`evaluateProposal` / `checkProposal`).

## What the proof UI shows

1. Live prices + agent feed with **multi-agent consensus** votes  
2. Fee-aware proposal → fail-closed PASS/BLOCK (incl. `CONSENSUS`, caps, fees)  
3. **Show blocked bad trade** — oversize / not-allowlisted / high slippage  
4. Honest **backtest** (CoinGecko history) — labeled *not a guarantee*  
5. Optional **real $1 swap** path (local mainnet flags only): non-dry quote → deposit → wallet sign → status poll  

## Real vs simulated

| Piece | Status |
| --- | --- |
| Guardrail engine / `/api/guard/check` | Real |
| CoinGecko prices + backtest series | Real when API allows; else unavailable (no fake PnL) |
| 1Click dry quotes | Live when API succeeds; else labeled simulated |
| Executable 1Click + deposit status | Real code path; **gated** by dual mainnet flags |
| Agent spend (premium signal) | **Simulated** budget with caps |
| Consensus agents | Deterministic rules (optional NEAR AI enrich) |

## Run a real ≤$1 swap yourself

IntentRail **will not** flip mainnet flags on Vercel and **will not** sign for you.

1. Clone, `npm i`, copy `.env.example` → `.env.local`  
2. Set `NEAR_NETWORK=mainnet` **and** `ALLOW_MAINNET=true` **locally only**  
3. `npm run dev` → connect MyNearWallet (needs ability to `ft_transfer` USDC)  
4. Propose USDC→NEAR with **amount $1** → Approve → **Prepare executable quote** → confirm cap → **Sign deposit**  
5. Watch status poll (`SUCCESS` / `REFUNDED` / `FAILED`)

Hard cap: **$1 per mainnet swap** (server + client). Human click required at every step.

## How to run (demo)

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `/` or `/demo`. `npm run build && npm start` for production locally.

## License

MIT
