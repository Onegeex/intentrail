# IntentRail security model

The rule: funds move only when the GuardVault contract agrees. Everything off-chain can refuse a trade, but nothing off-chain can force one.

## Threats and controls

| If an attacker controls | They could try to | What stops them |
| --- | --- | --- |
| The agent or its prompt | Propose huge or bad trades | The guard prices trades itself and won't sign outside its limits. The contract re-checks its own limits regardless. |
| The agent's key | Withdraw, transfer, add keys, call other contracts | It's a NEAR function-call key for `execute` on the vault only. NEAR's protocol refuses everything else before it runs. |
| The agent's key | Edit a signed quote, replay one, reuse one for another vault | The contract verifies the guard's ed25519 signature over the exact quote, checks the vault id and expiry, and records every nonce. |
| The guard server and its key | Sign a drain | Contract caps in USD *and* raw token amounts, daily cap, token and venue allowlists, fee ceiling, owner approval above $4, and the owner's per-pair price floor, which the contract checks without trusting the guard. A signed $50 trade, or a signed sale at half price, is refused on-chain. |
| The guard server and its key, found out | Keep signing | The owner pauses instantly and rotates the guard key instantly; old-key quotes stop verifying. Resuming waits for the timelock. See `scripts/key-leak-drill.sh`. |
| The guard server | Route output to an attacker | No trade has a recipient field. The contract writes the Ref Finance swap itself, which pays the sender (the vault) or reverts. Venues must be on the owner's allowlist. |
| A bad fill or a bad pool | Fill a swap at a terrible price | The contract writes `min_amount_out` into the swap; Ref reverts below it and the tokens return to the vault, with the daily spend restored. |
| Anyone else | Trigger trades to burn the daily cap or gas | `execute` accepts only the agent's key on the vault or the owner. The public guard API never returns signed vault quotes. |
| The owner's key | Loosen limits quietly | Loosening changes (raising a cap, adding a token or venue, lowering a floor, resuming trading) wait out a timelock and are logged on-chain. |
| An agent's self-reported data | Mark its own trade as safe | The guard API ignores fee, stop-loss, slippage and vote claims and computes them from a live NEAR Intents quote. |
| The vault deployer | Keep a back door | The vault's only full-access key is deleted at the end of deployment (`scripts/deploy-testnet.sh`). Anyone can list its keys on-chain. |
| Missing live data | Price a trade on stale numbers | The guard fails closed: no live price or quote means no signature. |
| Request floods | Burn the agent's gas budget | Per-IP rate limits, plus global cooldowns on the agent and attack routes. The agent key's allowance is capped at 0.5 NEAR, and the owner can rotate the key. |

## The owner

The owner (`intentrail-owner-39ae84.testnet` on testnet) is the human in charge. They can tighten the policy or pause at once, loosen it only after the timelock, approve or cancel trades held above the autonomy limit, rotate the agent and guard keys, and withdraw, but only to the owner account.

## Secrets

`GUARD_SIGNING_KEY` and `AGENT_PRIVATE_KEY` live only in the host's encrypted environment variables. No key, seed phrase or private key is in the repository, logs or client bundle. Neither key can move funds on its own.

## The $1 mainnet swap

Separately from the vault, the site offers a real mainnet swap through NEAR Intents 1Click, signed in the user's own wallet. It's capped at $1 per swap and $3 per wallet per day, rate-limited, and the operator can turn it off with `MAINNET_DISABLED=true`.

## Reporting

Open an issue on https://github.com/Onegeex/intentrail, or contact the maintainer privately for anything sensitive.
