# IntentRail Security Model

IntentRail is an AI trading agent that can move value through NEAR Intents.
This document is the threat model and the controls we enforce. If a control and
a feature disagree, the control wins.

## Threat model

| Threat | What goes wrong | Mitigation |
| --- | --- | --- |
| Stolen server secrets | Attacker drains funds | No private keys or seeds on the server. Signing only in the user's wallet. |
| Prompt / agent runaway | Agent proposes unbounded trades | Hard caps, allowlist, daily spend, max loss, fee-aware filter, kill switch. |
| Client tampering | User edits amounts in DevTools | All guardrail checks re-run server-side; quote route re-checks before Intents. |
| Mainnet foot-gun | Accidental live spend on mainnet | Testnet default. Mainnet requires `NEAR_NETWORK=mainnet` **and** `ALLOW_MAINNET=true`. |
| Arbitrary contract calls | Agent calls unexpected methods | Allowlist of contract methods is empty by design on Day 1. No generic `functionCall` API. |
| Quote → spend confusion | Dry quote turned into deposit | Quote API is `dry: true` only. No deposit address flow in Day 1 UI. |
| Key phishing | App asks for seed phrase | App never accepts, stores, logs, or displays private keys or seeds. |
| Rate abuse | Flood propose/quote | Per-IP fixed-window rate limit on API routes; fail closed if IP unknown. |
| Kill switch reset | Restart clears halt | Kill switch persisted under `data/runtime-state.json` locally, or `/tmp/intentrail/` on Vercel, with in-memory fallback. Corrupt/unreadable state fails closed (kill ON). |

## Non-negotiables

1. **No private keys or seed phrases** in source, logs, client bundle, env committed to git, or chat. Use `.env.example` only; real values stay in `.env.local` / host secrets.
2. **Testnet by default.** Mainnet only behind the explicit dual flag above.
3. **Signing** only via:
   - the user's wallet (NEAR Wallet Selector / MyNearWallet), or
   - a **restricted function-call access key** (trade methods only, no `transfer` / `near:transfer`, low allowance). Day 1 UI uses full wallet approval per trade; FC-key wiring is documented for Day 2.
4. **Guardrails fail closed.** Any failed check ⇒ `BLOCK`. Checks run when proposing **and** again immediately before quote.
5. **Human approval required by default** for every trade (`REQUIRE_HUMAN_APPROVAL=true`).
6. **Strict input validation** with Zod: amount bounds, token allowlist, slippage cap.
7. **No arbitrary contract calls** from the agent or API.
8. **Kill switch persists** across process restarts.

## Guardrail checks (server)

- `KILL_SWITCH` — global halt
- `ALLOWLIST` — only NEAR, USDC, WETH (see `src/lib/tokens.ts`)
- `AMOUNT_BOUNDS` — `$1`–`$50` hard cap
- `MAX_LOSS` — stop-loss sized risk ≤ policy (default `$2`)
- `DAILY_CAP` — cumulative notional ≤ policy (default `$25`)
- `SLIPPAGE` — ≤ policy (default `100` bps; hard max `200`)
- `FEE_AWARE` — estimated edge must cover assumed Intents fee (~0.2% without JWT)
- `DISTINCT_ASSETS` — from ≠ to

Env vars can only **tighten** within `HARD_CAPS` in `src/lib/config.ts`, never exceed them.

## NEAR Intents notes (HACKATHON.md)

- Q-006: 1Click JWT optional; without it ~0.2% fee.
- Q-007: **No Intents testnet.** Live `dry: true` quotes only when mainnet is explicitly enabled; otherwise the quote route returns a deterministic stub so demos work safely on testnet.

## Reporting

If you find a vulnerability in IntentRail, do not open a public issue with exploit details. Email the team lead listed in the submission and rotate any exposed credentials immediately.


## Trade-only function-call keys (Day 2)

- Wallet Selector requests a **FunctionCallAccessKey** for a single allowlisted contract.
- Mainnet: `intents.near` methods `execute_intents`, `simulate_intents` only; small allowance (~0.25 NEAR).
- Testnet: `wrap.testnet` deposit/withdraw only (Intents has no testnet — Q-007).
- IntentRail **never** generates, stores, or logs private keys or seeds.
- Revoke in MyNearWallet → Security / Keys.

## Dry quotes vs execution

- `dry: true` 1Click quotes are read-only (no deposit address).
- Execution requires `NEAR_NETWORK=mainnet` **and** `ALLOW_MAINNET=true`, plus human approval + wallet sign.

## Swarm & Agent Economy

- Trend + Risk votes must both be `yes` (`SWARM_AGREE`) or the proposal is BLOCKed.
- Premium signal fees are simulated micro-payments with per-call and daily caps; kill switch blocks purchases.


## Mainnet $1 execution (opt-in, local only)

- Requires `NEAR_NETWORK=mainnet` **and** `ALLOW_MAINNET=true`.
- Public / Vercel demo must keep both off. IntentRail maintainers do not enable them on shared deploys.
- Per-swap hard cap: **$1** (`HARD_CAPS.maxMainnetSwapUsd`), enforced in `requestExecutableQuote`, `/api/execute/prepare`, and the client before `Sign deposit`.
- Flow: human approve → prepare non-dry 1Click quote → user signs `ft_transfer` to `depositAddress` in their wallet → poll `/api/execute/status`.
- Server never holds keys, never auto-signs, never submits deposits.

## Seatbelt API

`POST /api/guard/check` exposes the same fail-closed engine (`src/lib/guardrails.ts`) for other agents.
