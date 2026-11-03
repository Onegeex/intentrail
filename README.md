# IntentRail

**AI trading agent with hard guardrails on NEAR Intents.**

Built for [NEAR HACKATHON](https://nearhackathon.com).

## Tracks covered

| Track id | Track | How IntentRail fits |
| --- | --- | --- |
| `defi` | Unstoppable DeFi | Fee-aware agent + **NEAR Intents / 1Click** dry quotes |
| `security` | AI Security & Defense | Fail-closed guardrails, kill switch, trade-only **function-call keys** |
| `agents` | Agent Economy | Agent pays a **guardrailed micro-fee** for a premium signal |
| `swarms` | AI Swarms | **Trend + Risk** agents vote; both must agree before PASS |

## What

IntentRail proposes fee-aware swaps, runs a two-agent swarm vote, optionally buys a simulated premium signal (capped), fetches a **dry** NEAR Intents 1Click quote (live when possible, else clearly **simulated**), then applies fail-closed guardrails. Human approval is required before any execute. The app never holds private keys.

## Why NEAR

- **NEAR Intents / 1Click** — cross-chain quotes with `dry: true` (no deposit address)
- **Function-call access keys** — trade-only scope (`intents.near` methods on mainnet)
- **Wallet Selector / MyNearWallet** — user signs; server never sees a seed

## How to run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 or **/demo** (no wallet).

```bash
npm run build && npm start
```

### Environment (high level)

| Variable | Default | Notes |
| --- | --- | --- |
| `NEAR_NETWORK` | `testnet` | Mainnet ignored unless `ALLOW_MAINNET=true` |
| `ALLOW_MAINNET` | `false` | Dual flag for execution |
| `ALLOW_DRY_QUOTES` | `true` | Live 1Click dry API (read-only) |
| `NEAR_AI_ENABLED` | `false` | Optional NEAR AI Cloud enrichment (needs `NEAR_AI_API_KEY`) |
| `REQUIRE_HUMAN_APPROVAL` | `true` | Keep on |

Never put private keys or seed phrases in env files that get committed.

## Tech used (NEAR)

- NEAR Wallet Selector + MyNearWallet
- `near-api-js` available; signing stays in wallet
- NEAR Intents **1Click Swap API** (`dry: true`)
- Trade-only FC key scope → `intents.near` / `execute_intents` + `simulate_intents` (mainnet)
- Optional NEAR AI Cloud (env-flagged roadmap hook)
- CoinGecko public prices
- Next.js 15 on Vercel

HACKATHON.md Q-007: **no Intents testnet**. Dry quotes use the public mainnet 1Click API; execution stays off unless the dual mainnet flag is set.

## Do X → see Y (judges)

1. Open `/` → see **Live** prices (NEAR/USDC/BTC/ETH), guardrail status, agent feed.
2. Click **Propose trade** (USDC→NEAR, $5) → see **Swarm votes** (trend + risk), signal fee line, dry quote panel labeled **live 1Click** or **simulated**, and PASS/BLOCK checklist including `SWARM_AGREE`, `FEE_AWARE`, `QUOTE_DRY`.
3. Toggle **Kill switch** on → Propose again → **BLOCK** / `KILL_SWITCH`.
4. Connect wallet → modal requests a **trade-only function-call key** (contract + methods shown). Revoke steps are on the page.
5. Open `/demo` → same flow without a wallet.
6. Open `/security` → threat model.

## Real vs simulated

| Piece | Status |
| --- | --- |
| CoinGecko prices | Live (demo fallback) |
| 1Click dry quote | Live when API succeeds; else **simulated** label |
| Swarm votes | Deterministic agents (optional NEAR AI enrich if flagged) |
| Signal micro-payment | **Simulated** (capped; same fail-closed ledger) |
| Execution / deposits | **Disabled** unless mainnet dual flag |

## License

MIT
