use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const VAULT: &str = "vault.testnet";
const OWNER: &str = "owner.testnet";
const WRAP: &str = "wrap.testnet";
const ATTACKER: &str = "attacker.testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn guard() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn agent_pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}

fn other_pk() -> PublicKey {
    "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap()
}

fn policy() -> Policy {
    Policy {
        kill_switch: false,
        allowed_tokens: vec![acc(NEAR_TOKEN), acc(WRAP)],
        allowed_venues: vec![acc(WRAP)],
        max_amount_per_trade: vec![
            (acc(NEAR_TOKEN), U128(10u128.pow(24))), // 1 NEAR
            (acc(WRAP), U128(10u128.pow(24))),
        ],
        max_trade_usd_cents: U64(500),
        daily_cap_usd_cents: U64(1_200),
        approval_above_usd_cents: U64(300),
        max_cost_bps: 100,
    }
}

/// Context where the agent's function-call key on the vault signs the tx.
fn as_agent() {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(VAULT))
        .signer_account_id(acc(VAULT))
        .signer_account_pk(agent_pk())
        .block_timestamp(1_000 * 1_000_000);
    testing_env!(b.build());
}

fn as_account(who: &str) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .block_timestamp(1_000 * 1_000_000);
    testing_env!(b.build());
}

fn setup() -> GuardVault {
    as_account(OWNER);
    let pk = guard().verifying_key().to_bytes().to_vec();
    let mut v = GuardVault::new(acc(OWNER), Base64VecU8(pk), policy());
    v.agent_key = Some(agent_pk());
    v
}

fn quote(usd_cents: u64, amount: u128, nonce: u64) -> String {
    near_sdk::serde_json::json!({
        "vault": VAULT,
        "kind": "Wrap",
        "token_in": NEAR_TOKEN,
        "token_out": WRAP,
        "amount_in": amount.to_string(),
        "min_amount_out": amount.to_string(),
        "venue": WRAP,
        "msg": "",
        "usd_cents": usd_cents.to_string(),
        "cost_bps": 10,
        "nonce": nonce.to_string(),
        "expires_at_ms": "999999999",
    })
    .to_string()
}

fn sign(q: &str) -> Base64VecU8 {
    Base64VecU8(guard().sign(q.as_bytes()).to_bytes().to_vec())
}

const TENTH: u128 = 100_000_000_000_000_000_000_000;

#[test]
fn agent_trades_autonomously_within_limits() {
    let mut v = setup();
    as_agent();
    let q = quote(200, TENTH, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.status, Status::Executed, "{}", o.detail);
    assert_eq!(v.get_spent_today().0, 200);
    assert_eq!(v.get_stats().executed, 1);
}

#[test]
fn over_per_trade_cap_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(50_000, TENTH, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.status, Status::Rejected);
    assert_eq!(o.check, "SIZE");
    assert_eq!(v.get_spent_today().0, 0);
}

#[test]
fn raw_cap_holds_even_if_guard_lies_about_usd() {
    // A compromised guard signs a 50 NEAR trade as worth $1. The raw cap still stops it.
    let mut v = setup();
    as_agent();
    let q = quote(100, 50 * 10u128.pow(24), 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.status, Status::Rejected);
    assert_eq!(o.check, "SIZE");
}

#[test]
fn forged_signature_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(200, TENTH, 1);
    let forged = SigningKey::from_bytes(&[9u8; 32]).sign(q.as_bytes()).to_bytes().to_vec();
    let o = v.execute(q, Base64VecU8(forged));
    assert_eq!(o.check, "GUARD_SIGNATURE");
    assert_eq!(o.status, Status::Rejected);
}

#[test]
fn tampered_quote_is_rejected() {
    // Agent edits the amount after the guard signed it.
    let mut v = setup();
    as_agent();
    let q = quote(200, TENTH, 1);
    let sig = sign(&q);
    let edited = q.replace("\"usd_cents\":\"200\"", "\"usd_cents\":\"20\"");
    assert_ne!(q, edited);
    let o = v.execute(edited, sig);
    assert_eq!(o.check, "GUARD_SIGNATURE");
}

#[test]
fn replayed_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 42);
    assert_eq!(v.execute(q.clone(), sign(&q)).status, Status::Executed);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "QUOTE_REPLAY");
}

#[test]
fn daily_cap_stops_a_drip_drain() {
    // Many small trades, each under the per-trade cap, can't pass the daily cap.
    let mut v = setup();
    as_agent();
    let mut executed = 0;
    let mut last = None;
    for n in 0..10 {
        let q = quote(250, TENTH, 100 + n);
        let o = v.execute(q.clone(), sign(&q));
        if o.status == Status::Executed {
            executed += 1;
        }
        last = Some(o);
    }
    assert_eq!(executed, 4); // 4 x $2.50 = $10; the fifth would pass $12
    assert_eq!(last.unwrap().check, "DAILY_CAP");
    assert_eq!(v.get_spent_today().0, 1_000);
}

#[test]
fn unlisted_token_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace(&format!("\"token_out\":\"{}\"", WRAP), "\"token_out\":\"doge.testnet\"");
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "ALLOWLIST");
}

#[test]
fn unlisted_venue_is_rejected() {
    // Even a guard-signed quote can't send funds to an attacker's "venue".
    let mut v = setup();
    as_agent();
    let q = near_sdk::serde_json::json!({
        "vault": VAULT, "kind": "FtTransferCall", "token_in": WRAP, "token_out": NEAR_TOKEN,
        "amount_in": TENTH.to_string(), "min_amount_out": "0", "venue": ATTACKER, "msg": "",
        "usd_cents": "100", "cost_bps": 10, "nonce": "1", "expires_at_ms": "999999999"
    })
    .to_string();
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "VENUE");
}

#[test]
fn high_cost_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace("\"cost_bps\":10", "\"cost_bps\":400");
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "COST");
}

#[test]
fn quote_for_another_vault_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace(VAULT, "other-vault.testnet");
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "QUOTE_VAULT");
}

#[test]
fn expired_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace("999999999", "5");
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "QUOTE_EXPIRED");
}

#[test]
fn above_threshold_waits_for_owner_then_executes() {
    let mut v = setup();
    as_agent();
    let q = quote(450, TENTH, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.status, Status::PendingApproval);
    assert_eq!(v.get_spent_today().0, 0);
    assert_eq!(v.get_pending().len(), 1);

    as_account(OWNER);
    let a = v.approve(o.id);
    assert_eq!(a.status, Status::Approved);
    assert_eq!(v.get_spent_today().0, 450);
    assert!(v.get_pending().is_empty());
}

#[test]
fn kill_switch_stops_everything() {
    let mut v = setup();
    as_account(OWNER);
    v.set_kill_switch(true);
    as_agent();
    let q = quote(100, TENTH, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "KILL_SWITCH");
}

#[test]
#[should_panic(expected = "Only the vault's agent key or the owner can execute trades")]
fn outsider_cannot_execute() {
    let mut v = setup();
    as_account(ATTACKER);
    let q = quote(100, TENTH, 1);
    v.execute(q.clone(), sign(&q));
}

#[test]
#[should_panic(expected = "Signer is not the registered agent key")]
fn other_key_on_vault_cannot_execute() {
    let mut v = setup();
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(VAULT))
        .signer_account_pk(other_pk());
    testing_env!(b.build());
    let q = quote(100, TENTH, 1);
    v.execute(q.clone(), sign(&q));
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn agent_cannot_withdraw() {
    let mut v = setup();
    as_agent();
    let _ = v.withdraw(acc(NEAR_TOKEN), U128(TENTH));
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn agent_cannot_change_policy() {
    let mut v = setup();
    as_agent();
    let mut p = policy();
    p.max_trade_usd_cents = U64(1_000_000);
    p.daily_cap_usd_cents = U64(1_000_000);
    v.set_policy(p);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn agent_cannot_swap_its_own_key() {
    let mut v = setup();
    as_agent();
    let _ = v.set_agent_key(other_pk());
}
