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
| The owner's key alone | Drain the vault | Withdrawals go only to the owner account, which an attacker holding the key controls. So they wait out the timelock, and a separate guardian can veto them and pause. Looser limits wait too. Exit floor: alone, the owner can swap into the stablecoin at once, but for no less than 90% of the last guard-signed rate for that pair (before any trade, 90% of the price floor). Anything lower needs the guardian's approval or the timelock. So an attacker can't push the pool and dump the vault into it. |
| The guardian's key alone | Drain or unlock the vault | The guardian can only pause, veto, and approve a deep exit the owner asked for. It can't move funds, start an exit, resume trading or loosen anything. |
| Owner and guardian together | Drain the vault | They can, after the timelock, or exit at any price at once. This is the trust root. On mainnet both should be multisigs held by different people (not built yet), and the timelock should be a day. |
| A fully compromised guard server | Lose money slowly | The contract reads the Ref pool itself: a signed minimum more than 1% under the live output is refused (`POOL_QUOTE`), a pool more than 3% from the vault's own reference holds the trade (`PRICE_SHOCK`), and value given up against the higher of reference and live price is capped per key per day (`LEAK_BUDGET`, $0.20). Each refusal halves the key's autonomy. Worst case: about $0.04 a trade and $0.20 a day per key, versus about $7.60 a day with fixed floors alone. |
| A compromised guard that lies about value | Understate a trade's USD size to stretch caps | The contract values the trade on the pool through the dollar token (`usd_tokens`) and uses the higher of that and the guard's claim. |
| Everyone (the public challenge) | Use the published agent and guard keys | They are real keys on the vault, in their own lane: own $20 daily cap, own leak budget, own strikes. They can't sign for the real guard or touch the real agent's lane. Rotate or remove them with `set_challenge`. |
| An agent's self-reported data | Mark its own trade as safe | The guard API ignores fee, stop-loss, slippage and vote claims and computes them from a live NEAR Intents quote. |
| The vault deployer | Keep a back door | The vault's only full-access key is deleted at the end of deployment (`scripts/deploy-testnet.sh`). Anyone can list its keys on-chain. |
| Missing live data | Price a trade on stale numbers | The guard fails closed: no live price or quote means no signature. |
| Request floods | Burn the agent's gas budget | Per-IP rate limits, plus global cooldowns on the agent and attack routes. The agent key's gas budget is set by the owner (3 NEAR on the demo vault, capped at 5), and the owner can rotate the key. |

## The owner

The owner (`intentrail-owner-39ae84.testnet` on testnet) is the human in charge. They can tighten the policy or pause at once, loosen it only after the timelock, approve or cancel trades held above the autonomy limit, rotate the agent and guard keys, exit to the stablecoin at once down to the exit floor, and withdraw to the owner account after the timelock. The guardian (`intentrail-guardian-39ae84.testnet`) can pause, veto anything queued, and approve a deep exit the owner asked for, and nothing else.

## Secrets

`GUARD_SIGNING_KEY` and `AGENT_PRIVATE_KEY` live only in the host's encrypted environment variables. Neither key can move funds on its own. The only keys in the repository are the challenge pair in `src/data/challenge.json`, published on purpose.

## The $1 mainnet swap

Separately from the vault, the site offers a real mainnet swap through NEAR Intents 1Click, signed in the user's own wallet. It's capped at $1 per swap and $3 per wallet per day, rate-limited, and the operator can turn it off with `MAINNET_DISABLED=true`.

## Reporting

Open an issue on https://github.com/Onegeex/intentrail, or contact the maintainer privately for anything sensitive.
