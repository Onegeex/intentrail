# IntentRail

**AI trading agent with hard guardrails on NEAR Intents.**

Built for [NEAR HACKATHON](https://nearhackathon.com) (tracks: Unstoppable DeFi `defi`, AI Security & Defense `security`, Agent Economy `agents`).

## What

IntentRail proposes fee-aware token swaps, runs every proposal through a
fail-closed guardrail engine (max loss, daily spend cap, allowlist, slippage,
kill switch), requires **human approval**, then requests a **dry** NEAR Intents
/ 1Click quote. It never holds user private keys.

## Why

AI agents that can spend need rails, not vibes. NEAR gives us:

- **NEAR Intents / 1Click** — cross-chain settlement without a custodian
- **Function-call access keys** — trade-only keys with low allowance (no full account drain)
- **Wallet Selector** — user signs; the server never sees a seed

## Live home (`/`)

- Real-time CoinGecko prices for NEAR, USDC, BTC, ETH (15s server cache + client refresh)
- Live agent feed with PASS/BLOCK recomputed on every poll
- Guardrail status (kill switch, daily cap used) and Live / Degraded indicator
- Graceful fallback to demo prices if the public API fails

## How to run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 or **http://localhost:3000/demo** (no wallet).

```bash
npm run build && npm start
```

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `NEAR_NETWORK` | `testnet` | `mainnet` ignored unless `ALLOW_MAINNET=true` |
| `ALLOW_MAINNET` | `false` | Dual flag required for mainnet |
| `MAX_LOSS_PER_TRADE_USD` | `2` | Capped by hard max $10 |
| `DAILY_SPEND_CAP_USD` | `25` | Capped by hard max $100 |
| `MAX_SLIPPAGE_BPS` | `100` | Capped by hard max 200 |
| `REQUIRE_HUMAN_APPROVAL` | `true` | Keep on for demos/judging |
| `RATE_LIMIT_RPM` | `30` | Per IP, mutating/proposal routes |
| `ONECLICK_JWT` | _(empty)_ | Optional; never commit |

**Never put private keys or seed phrases in env files that get committed.**

## Tech used (NEAR)

- NEAR Wallet Selector + MyNearWallet (`@near-wallet-selector/*`)
- `near-api-js` (available for account/key introspection; signing stays in wallet)
- NEAR Intents **1Click Swap API** (`https://1click.chaindefuser.com`) with `dry: true`
- Public CoinGecko prices (allowlisted symbols only)
- Next.js 15 (App Router) on Vercel

Per HACKATHON.md Q-007 there is **no Intents testnet**. On testnet, dry-quotes are stubbed; set the mainnet dual flag for live dry quotes (still no deposit address).

## Do X → see Y (judges / AI screeners)

1. Open `/demo` → see the amber **Demo mode** banner and guardrail panel with kill switch **off**.
2. Click **Propose trade** (USDC→NEAR, $5) → see a proposal card with a green **PASS** or red **BLOCK** badge and a checklist (`KILL_SWITCH`, `ALLOWLIST`, `MAX_LOSS`, …).
3. Toggle **Kill switch** on → Propose again → see **BLOCK** with `KILL_SWITCH: Kill switch is ON`.
4. Toggle kill switch **off**. Propose a PASSing trade → click **Approve (human)** → see confirmation that approval was recorded.
5. Click **Dry-quote via NEAR Intents** → see a quote panel marked **stub** on testnet (or a live dry quote if mainnet flags are set).
6. Open `/security` → see this repo's threat model and non-negotiables.
7. Connect a wallet on `/` (optional) → MyNearWallet modal opens; the app never asks for a seed phrase.

## Project layout

```
src/app/api/     prices, propose, quote, guardrails, kill-switch, health
src/lib/         agent, guardrails, intents, tokens, validation, store, rate-limit
src/components/  AgentPanel, ProposalCard, GuardrailPanel, WalletConnect, KillSwitch
SECURITY.md      Threat model and controls
```

## Disclosure

Inspired by real fee-aware / stop-loss farming workflows the author runs elsewhere.
Only the NEAR Intents + guardrail integration in this repository is in scope for
NEAR HACKATHON judging (HACKATHON.md Q-002).

## License

MIT
