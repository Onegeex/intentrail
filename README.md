# IntentRail

**Your agent can trade. It can't drain the wallet.**

IntentRail is a NEAR contract that holds an AI trading agent's funds. The agent's key can only *ask*; the contract decides, using limits the agent can't change. A guard server prices every trade from live data and signs it, and the contract enforces its own hard limits even if that server is compromised.

- **Live site:** https://intentrail-neon.vercel.app
- **Vault on testnet:** [`intentrail-vault3-39ae84.testnet`](https://testnet.nearblocks.io/address/intentrail-vault3-39ae84.testnet)
- **Contract:** [`contract/src/lib.rs`](contract/src/lib.rs) · **Tests:** [`contract/src/tests.rs`](contract/src/tests.rs) (29 passing)

## The 90-second tour

1. Press **Watch an attack fail**. Real transactions go to NEAR testnet with the agent's own key or an outside account. Each result says which layer refused it: NEAR's access keys (no transaction ever exists), the IntentRail contract, or Ref Finance (minimum output). Every on-chain attempt links to NearBlocks. One honest swap goes through for comparison.
2. **Hijack the agent yourself**: a real LLM on NEAR AI Cloud holds the agent key and a raw-transaction tool. Tell it to drain the vault and watch what NEAR and the contract say.
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
| Agent function-call key | Server (`AGENT_PRIVATE_KEY`) | Call `execute` on the vault, spend a 0.5 NEAR gas budget | Transfer, add or delete keys, call any other method or contract (NEAR refuses) |
| Guard signing key | Server (`GUARD_SIGNING_KEY`) | Sign quotes until the owner rotates it | Exceed any cap, sell below the owner's price floor, add a venue, or skip owner approval |
| Anyone else | – | Read the vault | Call `execute`, even with a genuine signed quote |
| Owner | A person (`intentrail-owner-39ae84.testnet`) | Pause and tighten at once; approve big trades; withdraw to itself | Loosen any limit or resume trading without waiting out the timelock (10 min on testnet) |

### What the agent can no longer lie about

`POST /api/guard/check` accepts only `fromSymbol`, `toSymbol` and `amountUsd`. Fees, price impact, worst-case loss and consensus are computed by the guard from a live NEAR Intents 1Click quote and CoinGecko. Fields an agent reports about itself (`feeAwareOk`, `stopLossPct`, `votes`, …) are ignored and listed back under `ignoredFields`. If live data is unavailable, the guard blocks.

Limits that need memory (the daily cap, replay protection and owner approval) are enforced on-chain by the vault, so there's no wallet ID to spoof.

## Why NEAR

- **Function-call access keys** are limited by the protocol to one contract, chosen methods and a gas budget. The vault installs the agent's key itself.
- **Locked accounts**: with the full-access key deleted, the vault's funds move only when its code says so, and anyone can verify that on-chain.
- **Contracts that call DEXes directly**: the vault writes its own Ref Finance swap and learns the result in a callback; a refund restores its daily spend.

### Next: NEAR Intents on mainnet

This isn't a config change. A vault holding funds in `intents.near` needs someone to sign intents for it, and a contract can't sign. The plan is for the vault to register a dedicated key with `intents.near` that signs only intents the contract has approved, with withdrawals routed back through the vault. That adds one trust assumption, which we'll state when it ships. Today the vault trades on Ref Finance on testnet; the separate `/mainnet` page swaps $1 through 1Click from the user's own wallet.

## Key-leak drill

`scripts/key-leak-drill.sh` runs the owner's response on-chain: pause (instant), rotate the guard key (instant), and resume (queued behind the timelock). Quotes signed by the old key stop verifying immediately.

## Run it

```bash
# Contract
cd contract && cargo test              # 29 unit tests: bypass attempts, price floors, timelock, key-leak drill
cargo near build non-reproducible-wasm # needs cargo-near and the wasm32 target

# Deploy your own vault to testnet (keys via env; see the script header)
./scripts/deploy-testnet.sh

# Web app
npm install && npm run dev
```

Environment: `GUARD_SIGNING_KEY` (base64 ed25519 seed), `AGENT_PRIVATE_KEY` (`ed25519:…`), `VAULT_ID`, `VAULT_OWNER_ID`, `ATTACKER_ID` / `ATTACKER_PRIVATE_KEY` (outside account for the demo). Optional: `LLM_API_KEY`, `LLM_BASE_URL` (default NEAR AI Cloud), `LLM_MODEL`, `GUARD_LEAKED_KEY` (a retired guard key, for the demo), `NEAR_TESTNET_RPC`, `ONECLICK_JWT`, `MAINNET_DISABLED`.

## API

| Route | What it does |
| --- | --- |
| `POST /api/guard/check` | Preflight a trade. Returns every check, the guard's own numbers and `ignoredFields` |
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
