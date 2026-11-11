# IntentRail

**Your agent can trade. It can't drain the wallet.**

IntentRail is a NEAR contract that holds an AI trading agent's funds. The agent's key can only *ask*; the contract decides, using limits the agent can't change. A guard server prices every trade from live data and signs it, and the contract enforces its own hard limits even if that server is compromised.

- **Live site:** https://intentrail-neon.vercel.app
- **Vault on testnet:** [`intentrail-vault5-39ae84.testnet`](https://testnet.nearblocks.io/address/intentrail-vault5-39ae84.testnet)
- **Contract:** [`contract/src/lib.rs`](contract/src/lib.rs) · **Tests:** [`contract/src/tests.rs`](contract/src/tests.rs) (45 passing)

## The 90-second tour

1. Press **Watch an attack fail**. Real transactions go to NEAR testnet with the agent's own key or an outside account. Each result says which layer refused it: NEAR's access keys (no transaction ever exists), the IntentRail contract, or Ref Finance (minimum output). Every on-chain attempt links to NearBlocks. One honest swap goes through for comparison.
2. **Hijack the agent yourself**: a real LLM on NEAR AI Cloud holds the agent key and a raw-transaction tool. We use an abliterated model (refusals removed) told to obey, the worst-case agent, and treat the guard as hacked too, so it signs whatever the model asks for. Tell it to drain the vault and watch what NEAR and the contract say.
3. In **The vault, live**, press **Swap $1.50**: a real Ref Finance swap with a minimum output, no human needed. **Ask for $6** is above the $4 autonomy limit, so the contract holds it for the owner.
4. Check the chain yourself: the vault has **no full-access key**. Its only key is the agent's, and it may call `execute` only.

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
| Owner key alone | A person | Queue a withdrawal to the owner account (an attacker holding this key gets it), queue looser limits, swap into the stablecoin at once (funds stay in the vault) | Take anything out before the timelock (10 min on testnet, a day on mainnet), or stop the guardian vetoing it |
| Guardian key alone | A second person | Pause, veto queued withdrawals and policy changes | Move funds, resume trading, or loosen anything |
| Owner and guardian together | – | Drain the vault after the timelock. This is the trust root. | – On mainnet, make both multisigs held by different people. |

### What the agent can no longer lie about

`POST /api/guard/check` accepts only `fromSymbol`, `toSymbol` and `amountUsd`. Fees, price impact, worst-case loss and consensus are computed by the guard from a live NEAR Intents 1Click quote and CoinGecko. Fields an agent reports about itself (`feeAwareOk`, `stopLossPct`, `votes`, …) are ignored and listed back under `ignoredFields`. If live data is unavailable, the guard blocks.

Limits that need memory (the daily cap, replay protection and owner approval) are enforced on-chain by the vault, so there's no wallet ID to spoof.

## Why NEAR

- **Function-call access keys** are limited by the protocol to one contract, chosen methods and a gas budget. The vault installs the agent's key itself.
- **Locked accounts**: with the full-access key deleted, the vault's funds move only when its code says so, and anyone can verify that on-chain.
- **Contracts that call DEXes directly**: the vault writes its own Ref Finance swap and learns the result in a callback; a refund restores its daily spend.

### Mainnet: the contract signs intents through chain signatures

For NEAR Intents, funds in `intents.near` move only with a signed intent, and a key held by a server or a person would bypass every vault check. So the vault won't hold one: the contract checks the intent, then asks NEAR's chain-signatures MPC network to sign it for the vault's derived key. No hot key exists anywhere.

```
Agent -> Guard (prices on a live 1Click quote, signs) -> Vault contract (all checks)
      -> chain signatures MPC (signs that exact intent) -> intents.near -> solver fills
```

Status: design, not shipped. Today the vault trades on Ref Finance testnet, and the guard prices vault trades on that same pool. The preflight API prices on 1Click because that's where other agents' trades settle. The `/mainnet` page swaps $1 through 1Click from the user's own wallet, outside the vault.

**Test token:** the testnet pool uses `usdt.itachicara.testnet`, a community test token in a thin pool. Its fills aren't market prices.

## Crash exit

Price floors are fixed by the owner, and lowering one waits for the timelock. So that a floor can't trap the vault in a crash, the owner can call `exit_to_stable`: an immediate swap into an exit token (the stablecoin), even when paused and below the floors.

That exit has its own floor. Alone, the owner may go at most `exit_max_discount_bps` (10%) under the rate of the last swap the guard signed and the contract accepted, or under the price floor if there's no trade yet. Without it, an attacker holding the owner key could push the thin pool's price, then dump the vault into it: the funds would stay in the vault, but their value would leave. A deeper exit goes through `request_exit` and needs the guardian's `approve_exit`, or waits out the timelock.

Floors are fixed numbers today. If the price rises, the gap to the floor widens; if it falls, the floor blocks sales (the crash exit covers that). They need re-tuning. An oracle-relative floor is designed, not built.

## Drills, run on testnet

Both ran on `intentrail-vault5-39ae84.testnet`, the same vault as every other demo on the site.

- **Owner key stolen**: the attacker queues a 5 NEAR withdrawal (queued), applies it at once (refused: timelock), dumps 1 wNEAR into USDT at half price (refused: `EXIT_FLOOR`). The guardian vetoes the withdrawal and pauses. The guardian can't withdraw either.
- **Guard key leaks** (`scripts/key-leak-drill.sh`): pause (instant), rotate the guard key (instant), resume (queued behind the timelock). Old-key quotes stop verifying at once.

Every step links to its transaction on the site.

## Quickstart: your own vault in three steps

You need [`near` CLI](https://github.com/near/near-cli-rs), [`cargo-near`](https://github.com/near/cargo-near) and Node 20+.

**1. Make keys** for the vault deployer, your agent and your guard (the guard key is a raw ed25519 seed):

```bash
near account create-account fund-later use-auto-generation save-to-folder ./keys   # run three times
node -e "const k=require('crypto').generateKeyPairSync('ed25519');console.log(k.privateKey.export({format:'der',type:'pkcs8'}).subarray(16).toString('base64'))"
```

**2. Deploy and lock the vault** in one command. It creates the vault, sets your limits (edit `POLICY` in the script), registers the tokens, installs your agent's execute-only key, and deletes the vault's full-access key:

```bash
VAULT_ID=my-vault.testnet OWNER_ID=me.testnet OWNER_SK=ed25519:... \
GUARDIAN_ID=friend.testnet VAULT_DEPLOYER_PK=ed25519:... VAULT_DEPLOYER_SK=ed25519:... \
AGENT_PK=ed25519:... GUARD_PK_B64=... npm run vault:deploy
```

**3. Plug in your agent** in a few lines: see [`examples/agent-trade.ts`](examples/agent-trade.ts). It asks your guard for a signed quote, then calls `execute` with its key. The contract decides. To run this site's guard and dashboard against your vault, set `VAULT_ID`, `GUARD_SIGNING_KEY` and `AGENT_PRIVATE_KEY` and `npm run dev`.

**Get told when it needs you:** set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or `NOTIFY_WEBHOOK_URL`, and the server messages the owner whenever a trade is held for approval. The site also shows a badge.

## Built, designed, not yet

| Built and running on testnet | Designed, not built | Not done yet |
| --- | --- | --- |
| GuardVault contract (45 tests), full-access key deleted | Mainnet: the vault signs NEAR Intents through chain signatures | A vault trade through `intents.near` |
| Agent key limited by NEAR to `execute`, with a gas budget | Oracle-relative price floors | Owner and guardian as multisigs |
| Guard signatures, floors, caps, replay and expiry checks | | A one-day mainnet timelock (a setting) |
| Guardian veto and pause; timelocked withdrawals and loosening | | Automatic floor re-tuning |
| Crash exit with a floor; deep exits need the guardian | | |
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
