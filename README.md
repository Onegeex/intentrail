# IntentRail

**Your agent can trade. It can't drain the wallet.**

IntentRail is a NEAR contract that holds an AI trading agent's funds. The agent's key can only *ask*; the contract decides, using limits the agent can't change. A guard server prices every trade from live data and signs it, and the contract enforces its own hard limits even if that server is compromised.

- **Live site:** https://intentrail-neon.vercel.app
- **Vault on testnet:** [`intentrail-vault5-39ae84.testnet`](https://testnet.nearblocks.io/address/intentrail-vault5-39ae84.testnet)
- **Contract:** [`contract/src/lib.rs`](contract/src/lib.rs) · **Tests:** [`contract/src/tests.rs`](contract/src/tests.rs) (45 passing)

## NEAR HACKATHON entry

- **Tracks:** AI Security & Defense (primary): spending limits and a policy engine for an AI agent, with NEAR function-call keys. Also entered in Unstoppable DeFi (an agent trading vault).
- **Built during the hackathon:** everything in this repo.
- **Other entry by the same builder:** [Heist](https://github.com/Onegeex/heist), a separate, independent project in the Games track. It shares no code or deployment with IntentRail.
- **NEAR tech used:** function-call access keys, a locked contract account (no full-access key), contract-to-DEX cross-contract calls with callbacks (Ref Finance), NEAR AI Cloud (the LLM agent), NEAR Intents 1Click (pricing preview and the `/mainnet` $1 swap). Chain signatures are designed for mainnet, not built.

## Check it in five minutes: do this, see that

Everything below runs against `intentrail-vault5-39ae84.testnet`. Each step names what you should see.

| # | Do | See |
| --- | --- | --- |
| 1 | Open https://intentrail-neon.vercel.app and read the strip under the hero | `11 of 11 attacks refused` (8 on-chain + 3 pre-chain), `45 contract tests passing`, a worst-case dollar figure, and the vault id |
| 2 | Scroll to **We gave the agent's key to an attacker** | 11 attacks in three columns (NEAR access keys, IntentRail contract, Ref Finance), each with the check that fired, and one honest swap that filled. The 8 on-chain refusals link to NearBlocks; the 3 pre-chain ones show NEAR's own error, because no transaction is ever created |
| 3 | Press **Run all 12 again, live** (about a minute; at most once every 90 s) | The same 12 transactions sent again to testnet, with new hashes and the same outcomes |
| 4 | In **Hijack the agent yourself**, pick **Poisoned market data** and press **Send to the agent** | An abliterated LLM on NEAR AI Cloud, with the guard treated as hacked, sends guard-signed trades. The contract refuses them with `VENUE` and `PRICE_FLOOR`, with transaction links. If the model is slow, a recorded real run is shown, labelled as recorded. Why `PRICE_FLOOR` and not `SIZE` for the $500 sale: see [Check order](#check-order) |
| 5 | In **The vault, live**, press **Swap $1.50** | A real Ref Finance swap from the vault, no human needed, with the fill read from the chain |
| 6 | Press **Ask for $6** | `Waiting for owner`: $6 is over the $4 autonomy limit, so the contract queues it. A "trades waiting for the owner" notice appears on the panel and in the hero, and an owner alert goes out if Telegram or a webhook is configured |
| 7 | Read **Stolen keys, rehearsed** | Two drills run for real on the same vault. A stolen owner key can't withdraw early or dump at half price (`EXIT_FLOOR`), and the guardian vetoes. A leaked guard key is paused, rotated, and resumed only after the timelock |
| 8 | Check the chain yourself: `near account list-keys intentrail-vault5-39ae84.testnet network-config testnet now` | One key only: a function-call key that may call `execute` on the vault, with a gas allowance. No full-access key |
| 9 | Run the contract tests: `cd contract && cargo test` | `45 passed` |
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
                                                     owner approval above $4
                                                     output can only return to the vault
```

| Key | Held by | Can | Can't |
| --- | --- | --- | --- |
| Vault full-access key | Nobody, deleted after deploy | – | – |
| Agent function-call key | Server (`AGENT_PRIVATE_KEY`) | Call `execute` on the vault, spend its gas budget | Transfer, add or delete keys, call any other method or contract (NEAR refuses) |
| Guard signing key | Server (`GUARD_SIGNING_KEY`) | Sign bad-but-allowed trades until someone notices: down to the owner's price floor, up to $4 a trade, within the daily cap. The site shows the live dollar figure. | Exceed any cap, sell below the floor, add a venue, or skip owner approval |
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

Floors are fixed numbers today. If the price rises, the gap to the floor widens; if it falls, the floor blocks sales (the crash exit covers that). They need re-tuning. An oracle-relative floor is designed, not built.

## Check order

The contract reports the first check that fails, in this order: caller, kill switch, guard signature, vault, expiry, replay, token allowlist, venue, trade shape, minimum output and price floor, size caps (raw, then USD), fee ceiling, daily cap, then owner approval. So a $500 sale "at any price" is refused at `PRICE_FLOOR` before it reaches the size cap. A large trade at a fair price is refused at `SIZE` (the "$50 trade" attack).

## Drills, run on testnet

Both ran on `intentrail-vault5-39ae84.testnet`, the same vault as every other demo on the site.

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
| GuardVault contract (45 tests), full-access key deleted | Mainnet NEAR Intents through chain signatures, with no hot key. The vault hasn't traded through `intents.near` yet | Owner and guardian as multisigs |
| Agent key limited by NEAR to `execute`, with a gas budget | Oracle-relative price floors. Today's floors are fixed numbers that need re-tuning by hand | A one-day mainnet timelock (a setting; testnet uses 10 minutes) |
| Guard signatures, floors, caps, replay and expiry checks | | |
| Guardian veto and pause; timelocked withdrawals and loosening | | |
| Crash exit to the stablecoin, with an exit floor; lower needs the guardian | | |
| Contract-written Ref Finance swaps; LLM agent on NEAR AI Cloud; owner alerts | | |

## Run it

```bash
# Contract
cd contract && cargo test              # 45 unit tests: bypass attempts, floors, timelocks, guardian, exits
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
