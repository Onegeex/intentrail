#!/usr/bin/env bash
# The owner's response to a leaked guard key, on testnet.
#   1. Pause: kill switch on (instant).
#   2. Rotate the guard key (instant). Quotes signed by the old key stop verifying.
#   3. Resume: kill switch off. This loosens the policy, so it is queued behind the timelock.
#   4. After the timelock: apply.  Run with STEP=apply.
# Env: VAULT_ID, OWNER_ID, OWNER_SK, NEW_GUARD_PK_B64
set -euo pipefail
NET="network-config testnet"
owner_call() {
  near contract call-function as-transaction "$VAULT_ID" "$1" json-args "$2" prepaid-gas '50.0 Tgas' \
    attached-deposit '0 NEAR' sign-as "$OWNER_ID" $NET sign-with-plaintext-private-key "$OWNER_SK" send
}
if [ "${STEP:-start}" = "apply" ]; then
  echo "== Apply the queued resume"; owner_call apply_policy '{}'
  exit 0
fi
echo "== 1. Pause trading";            owner_call set_kill_switch '{"on":true}'
echo "== 2. Rotate the guard key";     owner_call set_guard_key "{\"guard_key\":\"$NEW_GUARD_PK_B64\"}"
echo "== 3. Ask to resume (queued)";   owner_call set_kill_switch '{"on":false}'
near contract call-function as-read-only "$VAULT_ID" get_pending_policy json-args '{}' $NET now
