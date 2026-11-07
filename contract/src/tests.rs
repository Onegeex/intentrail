use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const VAULT: &str = "vault.testnet";
const OWNER: &str = "owner.testnet";
const WRAP: &str = "wrap.testnet";
const ATTACKER: &str = "attacker.testnet";
const REF: &str = "ref-finance-101.testnet";
const USDT: &str = "usdt.itachicara.testnet";
const TIMELOCK: u64 = 600_000;

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
        allowed_tokens: vec![acc(NEAR_TOKEN), acc(WRAP), acc(USDT)],
        allowed_venues: vec![acc(WRAP), acc(REF)],
        max_amount_per_trade: vec![
            (acc(NEAR_TOKEN), U128(10u128.pow(24))), // 1 NEAR
            (acc(WRAP), U128(10u128.pow(24))),
            (acc(USDT), U128(2 * 10u128.pow(24))),
        ],
        max_trade_usd_cents: U64(500),
        daily_cap_usd_cents: U64(1_200),
        approval_above_usd_cents: U64(300),
        max_cost_bps: 100,
        // At least 1.15 USDT per wNEAR.
        price_floors: vec![PriceFloor {
            token_in: acc(WRAP),
            token_out: acc(USDT),
            min_out_per_in_e6: U128(1_150_000),
        }],
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
    let mut v = GuardVault::new(acc(OWNER), Base64VecU8(pk), policy(), U64(TIMELOCK));
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
    let q = swap(TENTH, TENTH * 12 / 10, 1).replace(&format!("\"venue\":\"{}\"", REF), &format!("\"venue\":\"{}\"", ATTACKER));
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
    assert_eq!(v.set_kill_switch(true), "APPLIED");
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

fn swap(amount: u128, min_out: u128, nonce: u64) -> String {
    near_sdk::serde_json::json!({
        "vault": VAULT,
        "kind": { "RefSwap": { "pool_id": 1084 } },
        "token_in": WRAP,
        "token_out": USDT,
        "amount_in": amount.to_string(),
        "min_amount_out": min_out.to_string(),
        "venue": REF,
        "usd_cents": "100",
        "cost_bps": 30,
        "nonce": nonce.to_string(),
        "expires_at_ms": "999999999",
    })
    .to_string()
}

fn at_time(who: &str, ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .block_timestamp(ms * 1_000_000);
    testing_env!(b.build());
}

#[test]
fn swap_above_the_price_floor_executes() {
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 124 / 100, 1); // 1.24 USDT per wNEAR
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.status, Status::Executed, "{}", o.detail);
}

#[test]
fn swap_below_the_price_floor_is_refused_even_when_signed() {
    // A leaked guard key signs a swap that accepts half the market rate.
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 62 / 100, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "PRICE_FLOOR");
}

#[test]
fn swap_without_a_floor_is_refused() {
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH, 1)
        .replace(&format!("\"token_in\":\"{}\"", WRAP), "\"token_in\":\"TMP\"")
        .replace(&format!("\"token_out\":\"{}\"", USDT), &format!("\"token_out\":\"{}\"", WRAP))
        .replace("\"token_in\":\"TMP\"", &format!("\"token_in\":\"{}\"", USDT));
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "PRICE_FLOOR");
}

#[test]
fn swap_without_minimum_output_is_refused() {
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, 0, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "MIN_OUTPUT");
}

#[test]
fn wrap_must_be_one_to_one() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace(&format!("\"min_amount_out\":\"{}\"", TENTH), "\"min_amount_out\":\"1\"");
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "MIN_OUTPUT");
}

#[test]
fn tightening_applies_at_once() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.daily_cap_usd_cents = U64(600);
    assert_eq!(v.set_policy(p), "APPLIED");
    assert_eq!(v.get_policy().daily_cap_usd_cents.0, 600);
}

#[test]
fn loosening_waits_for_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.daily_cap_usd_cents = U64(1_000_000);
    assert_eq!(v.set_policy(p), "QUEUED");
    assert_eq!(v.get_policy().daily_cap_usd_cents.0, 1_200);
    assert!(v.get_pending_policy().is_some());
    at_time(OWNER, 1_000 + TIMELOCK);
    v.apply_policy();
    assert_eq!(v.get_policy().daily_cap_usd_cents.0, 1_000_000);
}

#[test]
#[should_panic(expected = "Timelock has not passed yet")]
fn loosening_cannot_skip_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.allowed_venues.push(acc(ATTACKER));
    v.set_policy(p);
    at_time(OWNER, 1_000 + TIMELOCK - 1);
    v.apply_policy();
}

#[test]
fn lowering_a_price_floor_is_loosening() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.price_floors[0].min_out_per_in_e6 = U128(1);
    assert_eq!(v.set_policy(p), "QUEUED");
}

#[test]
fn key_leak_drill_pause_is_instant_resume_is_timelocked() {
    let mut v = setup();
    as_account(OWNER);
    assert_eq!(v.set_kill_switch(true), "APPLIED");
    // Owner rotates the guard key straight away.
    let new_guard = SigningKey::from_bytes(&[11u8; 32]);
    v.set_guard_key(Base64VecU8(new_guard.verifying_key().to_bytes().to_vec()));
    // Turning trading back on waits.
    assert_eq!(v.set_kill_switch(false), "QUEUED");
    assert!(v.get_policy().kill_switch);
    // Quotes from the leaked key no longer verify, even after resuming.
    at_time(OWNER, 1_000 + TIMELOCK);
    v.apply_policy();
    as_agent();
    let q = quote(100, TENTH, 1);
    let o = v.execute(q.clone(), sign(&q));
    assert_eq!(o.check, "GUARD_SIGNATURE");
    let ok = Base64VecU8(new_guard.sign(q.as_bytes()).to_bytes().to_vec());
    let q2 = quote(100, TENTH, 2);
    let ok2 = Base64VecU8(new_guard.sign(q2.as_bytes()).to_bytes().to_vec());
    let _ = ok;
    assert_eq!(v.execute(q2, ok2).status, Status::Executed);
}
