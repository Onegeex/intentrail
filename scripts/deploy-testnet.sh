#!/usr/bin/env bash
# Deploy the IntentRail GuardVault (v2) to NEAR testnet and lock it down.
#
# Required env (never commit these):
#   VAULT_ID, OWNER_ID                      vault account to create; owner account (created if CREATE_OWNER=1)
#   GUARDIAN_ID / GUARDIAN_PK               guardian account (created if CREATE_GUARDIAN=1): can pause and veto, never move funds
#   VAULT_DEPLOYER_PK / VAULT_DEPLOYER_SK   temporary full-access key for the vault (deleted at the end)
#   OWNER_PK / OWNER_SK                     the human owner's key
#   AGENT_PK                                the agent's public key (gets a function-call key on the vault)
#   GUARD_PK_B64                            the guard server's ed25519 public key, base64
# Optional:
#   ATTACKER_ID / ATTACKER_PK               an outside account used by the attack demo
#   TIMELOCK_MS                             delay for loosening changes and withdrawals (default 600000 = 10 min on testnet; use a day on mainnet)
#   AGENT_ALLOWANCE                         agent key gas budget in yoctoNEAR (default 3 NEAR)
#   CHALLENGE_PK, CHALLENGE_GUARD_PK_B64    optional published challenge key pair
set -euo pipefail
NET="network-config testnet"
WASM=contract/target/near/intentrail_vault.wasm
WRAP=wrap.testnet
REF=ref-finance-101.testnet
USDT=usdt.itachicara.testnet
TIMELOCK_MS=${TIMELOCK_MS:-600000}
AGENT_ALLOWANCE=${AGENT_ALLOWANCE:-3000000000000000000000000}

say() { printf '\n== %s\n' "$*"; }
owner_call() { # method json deposit
  near contract call-function as-transaction "$VAULT_ID" "$1" json-args "$2" prepaid-gas '100.0 Tgas' \
    attached-deposit "$3" sign-as "$OWNER_ID" $NET sign-with-plaintext-private-key "$OWNER_SK" send
}

[ -f "$WASM" ] || (cd contract && cargo near build non-reproducible-wasm)

say "Create accounts (testnet faucet)"
if [ "${CREATE_OWNER:-0}" = "1" ]; then
  near account create-account sponsor-by-faucet-service "$OWNER_ID" use-manually-provided-public-key "$OWNER_PK" $NET create
fi
if [ "${CREATE_GUARDIAN:-0}" = "1" ]; then
  near account create-account sponsor-by-faucet-service "$GUARDIAN_ID" use-manually-provided-public-key "$GUARDIAN_PK" $NET create
fi
near account create-account sponsor-by-faucet-service "$VAULT_ID" use-manually-provided-public-key "$VAULT_DEPLOYER_PK" $NET create
if [ -n "${ATTACKER_ID:-}" ]; then
  near account create-account sponsor-by-faucet-service "$ATTACKER_ID" use-manually-provided-public-key "$ATTACKER_PK" $NET create
fi
sleep 3

# Price floors are raw output per raw input x 1e6. Both tokens have 24 decimals.
# Pool 1084 spot was ~1.245 USDT per wNEAR; floors sit ~7% under it.
POLICY=$(cat <<JSON
{
  "kill_switch": false,
  "allowed_tokens": ["near", "$WRAP", "$USDT"],
  "allowed_venues": ["$WRAP", "$REF"],
  "max_amount_per_trade": [["near", "3000000000000000000000000"], ["$WRAP", "3000000000000000000000000"], ["$USDT", "4000000000000000000000000"]],
  "max_trade_usd_cents": "1000",
  "daily_cap_usd_cents": "10000",
  "approval_above_usd_cents": "400",
  "max_cost_bps": 100,
  "price_floors": [
    {"token_in": "$WRAP", "token_out": "$USDT", "min_out_per_in_e6": "1150000"},
    {"token_in": "$USDT", "token_out": "$WRAP", "min_out_per_in_e6": "750000"}
  ],
  "exit_tokens": ["$USDT"],
  "exit_max_discount_bps": 1000,
  "max_slippage_bps": 100,
  "shock_bps": 300,
  "leak_budget_usd_cents": "20",
  "challenge_daily_cap_usd_cents": "2000",
  "usd_tokens": [["$USDT", 24]]
}
JSON
)
INIT=$(printf '{"owner":"%s","guardian":"%s","guard_key":"%s","policy":%s,"timelock_ms":"%s"}' "$OWNER_ID" "$GUARDIAN_ID" "$GUARD_PK_B64" "$POLICY" "$TIMELOCK_MS")

say "Deploy and initialise the vault"
near contract deploy "$VAULT_ID" use-file "$WASM" with-init-call new json-args "$INIT" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-plaintext-private-key "$VAULT_DEPLOYER_SK" send

say "Owner registers the vault with wrap.testnet, the USDT token and Ref Finance"
owner_call register_token "{\"token\":\"$WRAP\"}" '0.00125 NEAR'
owner_call register_token "{\"token\":\"$USDT\"}" '0.00125 NEAR'
owner_call register_token "{\"token\":\"$REF\"}" '0.01 NEAR'

say "Owner installs the agent's function-call key (execute only)"
owner_call set_agent_key "{\"public_key\":\"$AGENT_PK\",\"allowance\":\"$AGENT_ALLOWANCE\"}" '0 NEAR'
if [ -n "${CHALLENGE_PK:-}" ]; then
  # Optional: publish a challenge key pair anyone can attack with.
  owner_call set_challenge "{\"public_key\":\"$CHALLENGE_PK\",\"guard_key\":\"$CHALLENGE_GUARD_PK_B64\",\"allowance\":\"${CHALLENGE_ALLOWANCE:-2000000000000000000000000}\"}" '0 NEAR'
fi

say "Delete the vault's only full-access key. From here on, only contract code moves funds."
near account delete-keys "$VAULT_ID" public-keys "$VAULT_DEPLOYER_PK" $NET \
  sign-with-plaintext-private-key "$VAULT_DEPLOYER_SK" send

sleep 3
say "Vault access keys (expect one function-call key for execute only)"
near account list-keys "$VAULT_ID" $NET now
say "Vault policy"
near contract call-function as-read-only "$VAULT_ID" get_policy json-args '{}' $NET now
