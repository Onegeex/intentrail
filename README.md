# IntentRail

**Your agent can trade. It can't drain the wallet.**

IntentRail is a NEAR contract that holds an AI trading agent's funds. The agent's key can only *ask*; the contract decides, using limits the agent can't change. A guard server prices every trade from live data and signs it, and the contract enforces its own hard limits even if that server is compromised.

- **Live site:** https://intentrail-neon.vercel.app
- **Vault on testnet:** [`intentrail-vault-39ae84.testnet`](https://testnet.nearblocks.io/address/intentrail-vault-39ae84.testnet)
- **Contract:** [`contract/src/lib.rs`](contract/src/lib.rs) · **Tests:** [`contract/src/tests.rs`](contract/src/tests.rs) (19 passing)

## The 90-second tour

1. Open the site and press **Watch an attack fail**. Eight real transactions are sent to NEAR testnet with the agent's own key. Seven attempts to take money out are refused, by NEAR's protocol or by the contract, and one honest trade goes through. Every contract refusal links to its transaction on NearBlocks.
2. In **The vault, live**, press **Trade $1.50**. The agent trades on its own, with no human. Then press **Ask for $6**: it's above the $4 autonomy limit, so the contract holds it for the owner.
3. Check the chain yourself: the vault has **no full-access key**. Its only key is the agent's, and it may call `execute` only.

## Where enforcement lives

```
 Agent ──proposes──▶ Guard server ──signed quote──▶ GuardVault contract ──▶ Venue
 (pair + size)       live CoinGecko price            verifies signature      wrap.testnet (testnet)
                     live NEAR Intents 1Click quote  fresh, single-use       intents.near (mainnet)
                     fees + price impact             token + venue allowlist
                     worst-case loss                 per-trade cap (USD and raw)
                     own trend + risk agents         daily cap, fee ceiling
                     → signs ed25519                 kill switch
                                                     owner approval above $4
                                                     output can only return to the vault
```

| Key | Held by | Can | Can't |
| --- | --- | --- | --- |
| Vault full-access key | Nobody, deleted after deploy | – | – |
| Agent function-call key | Server (`AGENT_PRIVATE_KEY`) | Call `execute` on the vault, spend a 0.5 NEAR gas budget | Transfer, add or delete keys, call any other method or contract (NEAR refuses) |
| Guard signing key | Server (`GUARD_SIGNING_KEY`) | Sign quotes | Exceed any contract limit: a validly signed $50 trade is refused |
| Owner | A person (`intentrail-owner-39ae84.testnet`) | Change limits, approve big trades, kill switch, withdraw to itself | – |

### What the agent can no longer lie about

`POST /api/guard/check` accepts only `fromSymbol`, `toSymbol` and `amountUsd`. Fees, price impact, worst-case loss and consensus are computed by the guard from a live NEAR Intents 1Click quote and CoinGecko. Fields an agent reports about itself (`feeAwareOk`, `stopLossPct`, `votes`, …) are ignored and listed back under `ignoredFields`. If live data is unavailable, the guard blocks.

Limits that need memory (the daily cap, replay protection and owner approval) are enforced on-chain by the vault, so there's no wallet ID to spoof.

## Why NEAR

- **Function-call access keys** are limited by the protocol to one contract, chosen methods and a gas budget. The vault installs the agent's key itself. Elsewhere this needs a smart-contract wallet and a module system.
- **NEAR Intents** gives one vault access to cross-chain liquidity through `intents.near`, and the guard already prices every trade against live 1Click solver quotes. Pointing the vault at `intents.near` is a policy change (`set_policy`), not new code.
- **Locked accounts**: with the full-access key deleted, the vault's funds move only when its code says so, and anyone can verify that on-chain.

**Scope:** the vault runs on testnet and trades NEAR and wNEAR through `wrap.testnet`, because NEAR Intents runs on mainnet only. The guard's pricing uses live mainnet quotes. Separately, the site offers a real ≤$1 mainnet swap through 1Click, signed in the user's own wallet.

## Run it

```bash
# Contract
cd contract && cargo test              # 19 unit tests, including the bypass attempts
cargo near build non-reproducible-wasm # needs cargo-near and the wasm32 target

# Deploy your own vault to testnet (keys via env; see the script header)
./scripts/deploy-testnet.sh

# Web app
npm install && npm run dev
```

Environment: `GUARD_SIGNING_KEY` (base64 ed25519 seed), `AGENT_PRIVATE_KEY` (`ed25519:…`), `VAULT_ID`, `VAULT_OWNER_ID`. Optional: `NEAR_TESTNET_RPC`, `ONECLICK_JWT`, `MAINNET_DISABLED`.

## API

| Route | What it does |
| --- | --- |
| `POST /api/guard/check` | Preflight a trade. Returns every check, the guard's own numbers and `ignoredFields` |
| `GET /api/vault` | Live vault state from testnet: policy, keys, balances, today's spend, on-chain log |
| `POST /api/vault/run` | The agent trades through the vault (`{"size":"small"}` executes, `"large"` waits for the owner) |
| `POST /api/vault/attack` | Runs the eight bypass attempts on testnet (at most once every 90 seconds) |

## Repository

- `contract/`: GuardVault (Rust, near-sdk 5)
- `scripts/deploy-testnet.sh`: create accounts, deploy, install the agent key, delete the full-access key
- `src/lib/risk-engine.ts`: the guard's assessment, built only from live data
- `src/lib/vault.ts`, `src/lib/vault-agent.ts`: signing, the agent's transactions, the attack suite
- `src/app`: Next.js site and API routes

MIT licensed.
