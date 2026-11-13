# IntentRail

**Your agent can trade. It can't drain the wallet.**

IntentRail is a NEAR contract that holds an AI trading agent's funds. The agent's key can only *ask*; the contract decides, using limits the agent can't change. A guard server prices every trade and signs it, and the contract enforces its own limits even if that server is compromised.

Most agent guards ask you to trust their signing server. **We published ours.** The vault has a second agent key and a second guard key whose private halves are in this repo ([`src/data/challenge.json`](src/data/challenge.json)). Holding both is everything a hacked agent plus a hacked guard would have. Try to take the money: `node scripts/challenge.mjs`. What stops you is the contract alone: it reads the Ref Finance pool itself, refuses a signed minimum more than 1% under the live price, holds trades after a 3% price shock, caps value given up per key per day (a leak budget), halves the key's autonomy after every refusal, and values each trade on the pool rather than trusting the guard's number.

- **Live site:** https://intentrail-neon.vercel.app
- **Vault on testnet:** [`intentrail-vault7-39ae84.testnet`](https://testnet.nearblocks.io/address/intentrail-vault7-39ae84.testnet)
- **Contract:** [`contract/src/lib.rs`](contract/src/lib.rs) · **Tests:** [`contract/src/tests.rs`](contract/src/tests.rs) (57 passing)

## NEAR HACKATHON entry

- **Tracks:** AI Security & Defense (primary): spending limits and a policy engine for an AI agent, with NEAR function-call keys. Also entered in Unstoppable DeFi (an agent trading vault).
- **Built during the hackathon:** everything in this repo.
- **Other entry by the same builder:** [Heist](https://github.com/Onegeex/heist), a separate, independent project in the Games track. It shares no code or deployment with IntentRail.
- **NEAR tech used:** function-call access keys, a locked contract account (no full-access key), contract-to-DEX cross-contract calls with callbacks (Ref Finance), NEAR AI Cloud (the LLM agent), NEAR Intents 1Click (pricing preview and the `/mainnet` $1 swap). Chain signatures are designed for mainnet, not built.

## Check it in five minutes: do this, see that

Everything below runs against `intentrail-vault7-39ae84.testnet`. Each step names what you should see.

| # | Do | See |
| --- | --- | --- |
| 1 | Open https://intentrail-neon.vercel.app and read the strip under the hero | `12 of 12 attacks refused` (9 on-chain + 3 pre-chain), `57 contract tests passing`, a worst-case dollar figure, and the vault id |
| 2 | Scroll to **We gave the agent's key to an attacker** | 12 attacks in three columns (NEAR access keys, IntentRail contract, Ref Finance), each with the check that fired, and one honest swap that filled. They use the published challenge keys. The 9 on-chain refusals link to NearBlocks; the 3 pre-chain ones show NEAR's own error, because no transaction is ever created |
| 3 | Press **Run all 13 again, live** (about a minute; at most once every 90 s) | The same 13 transactions sent again to testnet, with new hashes and the same outcomes |
| 3b | In **Here are the keys. Take the money.**, copy the commands and run them | `node scripts/challenge.mjs --wnear 0.3 --give-away 3` is refused with `POOL_QUOTE`; `--method withdraw` is refused by NEAR; `--claim-usd 0.01` is counted at the pool's $0.37, not your $0.01 (it executes, or waits for the owner if the lane has recent refusals). The lane meters on the page move. Below: six trading attacks already run on testnet (loose minimum, slow bleed stopped by `LEAK_BUDGET`, autonomy cut by refusals, lying USD value) |
| 4 | In **Hijack the agent yourself**, pick **Poisoned market data** and press **Send to the agent** | An abliterated LLM on NEAR AI Cloud, holding the published challenge keys, sends guard-signed trades. The contract refuses them with `VENUE` and `PRICE_FLOOR`, with transaction links. If the model is slow, a recorded real run is shown, labelled as recorded. Why `PRICE_FLOOR` and not `SIZE` for the $500 sale: see [Check order](#check-order) |
| 5 | In **The vault, live**, press **Swap $1.50** | A real Ref Finance swap from the vault, no human needed, with the fill read from the chain |
| 6 | Press **Ask for $6** | `Waiting for owner`: $6 is over the $4 autonomy limit, so the contract queues it. A "trades waiting for the owner" notice appears on the panel and in the hero, and an owner alert goes out if Telegram or a webhook is configured |
| 7 | Read **Stolen keys, rehearsed** | Two drills run for real on the same vault. A stolen owner key can't withdraw early or dump at half price (`EXIT_FLOOR`), and the guardian vetoes. A leaked guard key is paused, rotated, and resumed only after the timelock |
| 8 | Check the chain yourself: `near account list-keys intentrail-vault7-39ae84.testnet network-config testnet now` | Two function-call keys that may only call `execute` on the vault, each with a gas allowance: the agent's and the published challenge key. No full-access key |
| 9 | Run the contract tests: `cd contract && cargo test` | `57 passed` |
| 10 | Read **What's real, and what isn't yet** | What's built, what's designed, and what's not done |

## Where enforcement lives

```
 Agent ──proposes──▶ Guard server ──signed quote──▶ GuardVault contract ──▶ Ref Finance
 (pair + size)       Ref pool quote + spot           caller is the agent key  writes the swap itself;
                     fees + price impact             verifies signature       fills at >= min output
                     live NEAR price (USD caps)      fresh, single-use        or refunds the vault
                                                     token + venue allowlist
                                                     per-trade cap (USD and raw)
                                                     daily cap, fee ceiling
                     min output 0.5% under quote     owner's price floor per pair
                     → signs ed25519                 kill switch
                                                     ── then reads the Ref pool itself ──
                                                     value on the pool, size cap again
                                                     min output ≤ 1% under live (POOL_QUOTE)
                                                     ≤ 3% from its own reference (PRICE_SHOCK)
                                                     daily leak budget per key (LEAK_BUDGET)
                                                     owner approval above the key's autonomy
                                                       ($4, halved per recent refusal)
                                                     output can only return to the vault
```

| Key | Held by | Can | Can't |
| --- | --- | --- | --- |
| Vault full-access key | Nobody, deleted after deploy | – | – |
| Agent function-call key | Server (`AGENT_PRIVATE_KEY`) | Call `execute` on the vault, spend its gas budget | Transfer, add or delete keys, call any other method or contract (NEAR refuses) |
| Guard signing key | Server (`GUARD_SIGNING_KEY`) | Sign bad-but-allowed trades until the leak budget runs out: at most 1% under the live pool per trade (about $0.04 on a $4 trade), $0.20 a day per key. With fixed floors alone it would be about $7.60 a day. The site shows the live figures. | Sign a minimum more than 1% under the pool, understate a trade's value, exceed any cap, add a venue, or skip owner approval |
| Challenge keys (agent + guard) | **Everyone: published in this repo** | Everything both keys above can do, in their own lane: own $20 daily cap, own leak budget, own strikes | Touch the real agent's lane, sign for the real guard, or anything the row above can't |
| Anyone else | – | Read the vault | Call `execute`, even with a genuine signed quote |
| Owner key alone | A person | Queue a withdrawal to the owner account (an attacker holding this key gets it), queue looser limits, exit into the stablecoin at once, down to the exit floor (90% of the last guard-signed rate) | Take anything out before the timelock (10 min on testnet, a day on mainnet), stop the guardian vetoing it, or exit below the exit floor without the guardian |
| Guardian key alone | A second person | Pause, veto queued withdrawals, policy changes and deep exits; approve a deep exit the owner asked for | Move funds, start an exit, resume trading, or loosen anything |
| Owner and guardian together | – | Drain the vault after the timelock, or exit at any price. This is the trust root. | – On mainnet, make both multisigs held by different people (not built yet). |

### What the agent can no longer lie about

`POST /api/guard/check` accepts only `fromSymbol`, `toSymbol` and `amountUsd`. Fees, price impact, worst-case loss and consensus are computed by the guard from a live NEAR Intents 1Click quote and CoinGecko. Fields an agent reports about itself (`feeAwareOk`, `stopLossPct`, `votes`, …) are ignored and listed back under `ignoredFields`. If live data is unavailable, the guard blocks.

Limits that need memory (the daily cap, replay protection and owner approval) are enforced on-chain by the vault, so there's no wallet ID to spoof.

## Why NEAR

- **Function-call access keys** are limited by the protocol to one contract, chosen methods and a gas budget. The vault installs the agent's key itself.
- **Locked accounts**: with the full-access key deleted, the vault's funds move only when its code says so, and anyone can verify that on-chain.
- **Contracts that call DEXes directly**: the vault writes its own Ref Finance swap and learns the result in a callback; a refund restores its daily spend.

### Next, on mainnet: the contract will sign intents through chain signatures

On mainnet, funds in `intents.near` will move only with a signed intent, and a key held by a server or a person would bypass every vault check. So the vault will never hold one: the contract will check each intent, then ask NEAR's chain-signatures MPC network to sign it for the vault's derived key. No hot key will exist anywhere.

```
Agent -> Guard (prices on a live 1Click quote, signs) -> Vault contract (all checks)
      -> chain signatures MPC (signs that exact intent) -> intents.near -> solver fills
```

Status: planned, not shipped. Today the vault trades on Ref Finance testnet, and the guard prices vault trades on that same pool. The preflight API prices on 1Click because that's where other agents' trades settle. The `/mainnet` page swaps $1 through 1Click from the user's own wallet, outside the vault.

**Test token:** the testnet pool uses `usdt.itachicara.testnet`, a community test token in a thin pool. Its fills aren't market prices.

## Crash exit

Price floors are fixed by the owner, and lowering one waits for the timelock. So that a floor can't trap the vault in a crash, the owner can call `exit_to_stable`: an immediate swap into an exit token (the stablecoin), even when paused and below the floors.

**Exit floor:** alone, the owner can swap into the stablecoin at once, but for no less than 90% of the last guard-signed rate for that pair (before any trade, 90% of the price floor). Anything lower needs the guardian's approval or the timelock.

In the contract this is `exit_max_discount_bps` = 1000. Without it, an attacker holding the owner key could push the thin pool's price, then dump the vault into it: the funds would stay in the vault, but their value would leave. A lower exit goes through `request_exit` and needs the guardian's `approve_exit`, or waits out the timelock.

Floors are fixed numbers, and they are now the last line, not the main one: for swaps the contract also checks the live pool, a moving reference price and the leak budget.

## Trading defenses (v7)

| Check | Rule | Why |
| --- | --- | --- |
| `POOL_QUOTE` | Before sending a swap the contract calls Ref's `get_return` itself. The signed minimum must be at least the live output minus `max_slippage_bps` (1%). If the pool can't be read, the swap isn't sent. | A hacked guard can't sign a loose minimum and pocket the gap through a sandwich |
| `PRICE_SHOCK` | The vault keeps its own reference rate per pair (moves 1/4 of the way on each accepted swap). A live rate more than `shock_bps` (3%) away holds the trade for the owner. | A pushed or manipulated pool can't be traded into without a human |
| `LEAK_BUDGET` | Value given up on each swap is measured against the higher of the reference and live rate, and summed per key per day (`leak_budget_usd_cents`, $0.20). | Many "fair-looking" 0.9% give-aways add up; this caps the total |
| Adaptive autonomy | Each refusal adds a strike (max 8); one strike wears off every 15 minutes. The key's autonomy is `approval_above >> strikes`. | A key that keeps probing loses the right to trade alone, fast |
| On-chain valuation | `usd_tokens` lists the dollar token. The contract values the trade on the pool and keeps the higher of that and the guard's claim, then re-checks the size and daily caps. | A lying guard can't understate size to stretch the caps |
| Lanes | Each key (agent, challenge) has its own spend, leak, strikes and cap (`challenge_daily_cap_usd_cents`, $20). | The public challenge can't freeze or drain the real agent's budget |

All of these count as loosening if relaxed, so they wait for the timelock. `PRICE_SHOCK` is unit-tested only: the testnet pool is too deep to move 3% on demand.

## Check order

The contract reports the first check that fails, in this order: caller, kill switch, guard signature, vault, expiry, replay, token allowlist, venue, trade shape, minimum output and price floor, size caps (raw, then USD), fee ceiling, daily cap. For a swap it then reads the pool, in a callback: value on the pool and size again, `POOL_QUOTE`, `PRICE_SHOCK`, `LEAK_BUDGET`, daily cap again. Last comes owner approval. So a $500 sale "at any price" is refused at `PRICE_FLOOR` before it reaches the size cap. A large trade at a fair price is refused at `SIZE` (the "$50 trade" attack).

## Drills, run on testnet

Both ran on `intentrail-vault7-39ae84.testnet`, the same vault as every other demo on the site.

- **Owner key stolen**: the attacker queues a 5 NEAR withdrawal (queued), applies it at once (refused: timelock), dumps 1 wNEAR into USDT at half price (refused: `EXIT_FLOOR`). The guardian vetoes the withdrawal and pauses. The guardian can't withdraw either.
- **Guard key leaks** (`scripts/key-leak-drill.sh`): pause (instant), rotate the guard key (instant), resume (queued behind the timelock). Old-key quotes stop verifying at once.

Every step links to its transaction on the site.

## Quickstart: your own vault in three steps

You need [`near` CLI](https://github.com/near/near-cli-rs), [`cargo-near`](https://github.com/near/cargo-near) and Node 20+.

**1. Get the code, build and test the contract:**

```bash
git clone https://github.com/Onegeex/intentrail && cd intentrail
npm install
rustup target add wasm32-unknown-unknown
cargo install cargo-near near-cli-rs
(cd contract && cargo test && cargo near build non-reproducible-wasm)
```

**2. Make keys, then deploy and lock your vault in one command.** The script creates the vault account, sets your limits (edit `POLICY` in `scripts/deploy-testnet.sh`), registers the tokens, installs your agent's execute-only key, and deletes the vault's full-access key.

```bash
# Key pairs for the vault deployer and your agent (prints public and secret keys)
near account create-account fund-later use-auto-generation save-to-folder ./keys
near account create-account fund-later use-auto-generation save-to-folder ./keys

# Your guard's ed25519 seed (keep it secret) and its public key, both base64
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');console.log('GUARD_SIGNING_KEY='+k.privateKey.export({format:'der',type:'pkcs8'}).subarray(16).toString('base64'));console.log('GUARD_PK_B64='+k.publicKey.export({format:'der',type:'spki'}).subarray(12).toString('base64'))"

export VAULT_ID=my-vault.testnet OWNER_ID=me.testnet OWNER_SK=ed25519:...
export GUARDIAN_ID=friend.testnet
export VAULT_DEPLOYER_PK=ed25519:... VAULT_DEPLOYER_SK=ed25519:...
export AGENT_PK=ed25519:... GUARD_PK_B64=...
npm run vault:deploy

# Check: one function-call key for execute only, no full-access key
near account list-keys "$VAULT_ID" network-config testnet now
```

**3. Plug in your agent** in a few lines: see [`examples/agent-trade.ts`](examples/agent-trade.ts). It asks your guard for a signed quote, then calls `execute` with its key. The contract decides. To run this site's guard and dashboard against your vault, set `VAULT_ID`, `GUARD_SIGNING_KEY` and `AGENT_PRIVATE_KEY` and `npm run dev`.

**Get told when it needs you:** set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or `NOTIFY_WEBHOOK_URL`, and the server messages the owner whenever a trade is held for approval. The site also shows a badge.

## Built, designed, not yet

| Built and running on testnet | Designed, not built | Not done yet |
| --- | --- | --- |
| GuardVault contract (57 tests), full-access key deleted | Mainnet NEAR Intents through chain signatures, with no hot key. The vault hasn't traded through `intents.near` yet | Owner and guardian as multisigs |
| Agent key limited by NEAR to `execute`, with a gas budget | An external oracle for the price-shock reference. Today it's the vault's own moving average of the pool | A one-day mainnet timelock (a setting; testnet uses 10 minutes) |
| Guard signatures, floors, caps, replay and expiry checks | | |
| Live pool check, price-shock hold, daily leak budget, adaptive autonomy, on-chain valuation | | |
| Public challenge: agent and guard keys published, in their own lane | | |
| Guardian veto and pause; timelocked withdrawals and loosening | | |
| Crash exit to the stablecoin, with an exit floor; lower needs the guardian | | |
| Contract-written Ref Finance swaps; LLM agent on NEAR AI Cloud; owner alerts | | |

## Run it

```bash
# Contract
cd contract && cargo test              # 57 unit tests: bypasses, pool checks, leak budget, autonomy, timelocks, guardian, exits
cargo near build non-reproducible-wasm # needs cargo-near and the wasm32 target

# Deploy your own vault to testnet (keys via env; see the script header)
./scripts/deploy-testnet.sh

# Web app
npm install && npm run dev
```

Environment: `GUARD_SIGNING_KEY` (base64 ed25519 seed), `AGENT_PRIVATE_KEY` (`ed25519:…`), `VAULT_ID`, `VAULT_OWNER_ID`, `ATTACKER_ID` / `ATTACKER_PRIVATE_KEY` (outside account for the demo). Optional: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` or `NOTIFY_WEBHOOK_URL` (owner alerts), `LLM_API_KEY`, `LLM_BASE_URL` (default NEAR AI Cloud), `LLM_MODEL`, `GUARD_LEAKED_KEY` (a retired guard key, for the demo), `NEAR_TESTNET_RPC`, `ONECLICK_JWT`, `MAINNET_DISABLED`.

## API

| Route | What it does |
| --- | --- |
| `POST /api/guard/check` | Intents pricing preview, separate from the vault: preflights a trade on a live mainnet 1Click quote. Returns every check, the guard's own numbers and `ignoredFields` |
| `GET /api/vault` | Live vault state from testnet: policy, keys, balances, today's spend, on-chain log |
| `POST /api/vault/run` | The agent trades through the vault (`{"size":"small"}` executes, `"large"` waits for the owner) |
| `POST /api/vault/attack` | Runs the bypass attempts on testnet, labelled by the layer that refused each (at most once every 90 seconds) |
| `POST /api/agent/chat` | Talk to the LLM agent (`{"message":"…","hijacked":true}`); needs `LLM_API_KEY` |

## Repository

- `contract/`: GuardVault (Rust, near-sdk 5)
- `scripts/deploy-testnet.sh`: create accounts, deploy, install the agent key, delete the full-access key
- `src/lib/risk-engine.ts`: the guard API's assessment, built only from live data
- `src/lib/llm-agent.ts`: the LLM agent and its tools
- `src/lib/vault.ts`, `src/lib/vault-agent.ts`: signing, the agent's transactions, the attack suite
- `src/app`: Next.js site and API routes

MIT licensed.

## Also by this builder

[Heist](https://github.com/Onegeex/heist) is a separate, independent NEAR HACKATHON submission: a game where players try to talk an AI guardian into opening a bounty vault. It does not import IntentRail's code; its vault contract was written separately.
