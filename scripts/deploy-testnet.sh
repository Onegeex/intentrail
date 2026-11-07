#!/usr/bin/env bash
# Deploy the IntentRail GuardVault to NEAR testnet and lock it down.
#
# Required env (never commit these):
#   VAULT_ID, OWNER_ID                     account ids to create
#   VAULT_DEPLOYER_PK / VAULT_DEPLOYER_SK  temporary full-access key for the vault (deleted at the end)
#   OWNER_PK / OWNER_SK                    the human owner's key
#   AGENT_PK                               the agent's public key (gets a function-call key on the vault)
#   GUARD_PK_B64                           the guard server's ed25519 public key, base64
#
# Needs: near-cli-rs, cargo-near. Run from the repo root.
set -euo pipefail
NET="network-config testnet"
WASM=contract/target/near/intentrail_vault.wasm
WRAP=wrap.testnet

say() { printf '\n== %s\n' "$*"; }

[ -f "$WASM" ] || (cd contract && cargo near build non-reproducible-wasm)

say "Create owner and vault accounts (testnet faucet)"
near account create-account sponsor-by-faucet-service "$OWNER_ID" use-manually-provided-public-key "$OWNER_PK" $NET create
near account create-account sponsor-by-faucet-service "$VAULT_ID" use-manually-provided-public-key "$VAULT_DEPLOYER_PK" $NET create
sleep 3

POLICY=$(cat <<JSON
{
  "kill_switch": false,
  "allowed_tokens": ["near", "$WRAP"],
  "allowed_venues": ["$WRAP"],
  "max_amount_per_trade": [["near", "3000000000000000000000000"], ["$WRAP", "3000000000000000000000000"]],
  "max_trade_usd_cents": "1000",
  "daily_cap_usd_cents": "2500",
  "approval_above_usd_cents": "400",
  "max_cost_bps": 100
}
JSON
)
INIT=$(printf '{"owner":"%s","guard_key":"%s","policy":%s}' "$OWNER_ID" "$GUARD_PK_B64" "$POLICY")

say "Deploy and initialise the vault"
near contract deploy "$VAULT_ID" use-file "$WASM" with-init-call new json-args "$INIT" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-plaintext-private-key "$VAULT_DEPLOYER_SK" send

say "Owner registers the vault with wrap.testnet"
near contract call-function as-transaction "$VAULT_ID" register_token json-args "{\"token\":\"$WRAP\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$OWNER_ID" $NET \
  sign-with-plaintext-private-key "$OWNER_SK" send

say "Owner installs the agent's function-call key (execute only)"
near contract call-function as-transaction "$VAULT_ID" set_agent_key json-args "{\"public_key\":\"$AGENT_PK\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER_ID" $NET \
  sign-with-plaintext-private-key "$OWNER_SK" send

say "Delete the vault's only full-access key. From here on, only contract code moves funds."
near account delete-keys "$VAULT_ID" public-keys "$VAULT_DEPLOYER_PK" $NET \
  sign-with-plaintext-private-key "$VAULT_DEPLOYER_SK" send

sleep 3
say "Vault access keys (expect one function-call key for execute only)"
near account list-keys "$VAULT_ID" $NET now
say "Vault policy"
near contract call-function as-read-only "$VAULT_ID" get_policy json-args '{}' $NET now
