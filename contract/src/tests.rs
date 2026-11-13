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
const GUARDIAN: &str = "guardian.testnet";

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
        exit_tokens: vec![acc(USDT)],
        exit_max_discount_bps: 1_000,
        max_slippage_bps: 100,
        shock_bps: 300,
        leak_budget_usd_cents: U64(50),
        challenge_daily_cap_usd_cents: U64(600),
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
    let mut v = GuardVault::new(acc(OWNER), acc(GUARDIAN), Base64VecU8(pk), policy(), U64(TIMELOCK));
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

#[allow(deprecated)]
fn ctx(pred: AccountId, pk: PublicKey, ts: u64, results: Vec<near_sdk::PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred)
        .signer_account_pk(pk)
        .block_timestamp(ts);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}

/// Run execute; for swaps, play Ref's live quote into on_pool_quote.
/// By default the pool pays 0.5% more than the signed minimum.
#[allow(deprecated)]
fn run_with(v: &mut GuardVault, q: String, s: Base64VecU8, live: Option<u128>) -> Outcome {
    // Fresh context per call, as on chain: the mock otherwise keeps counting gas.
    let (p0, k0, t0) = (env::predecessor_account_id(), env::signer_account_pk(), env::block_timestamp());
    ctx(p0, k0, t0, vec![]);
    match v.execute(q.clone(), s) {
        PromiseOrValue::Value(o) => o,
        PromiseOrValue::Promise(_) => {
            let pred = env::predecessor_account_id();
            let pk = env::signer_account_pk();
            let ts = env::block_timestamp();
            let quote: Quote = near_sdk::serde_json::from_str(&q).unwrap();
            let live = live.unwrap_or(quote.min_amount_out.0 / 1000 * 1005);
            let id = U64(v.next_id - 1);
            let lane = if v.challenge_key.as_ref() == Some(&pk) { 1 } else { 0 };
            ctx(
                acc(VAULT),
                pk.clone(),
                ts,
                vec![near_sdk::PromiseResult::Successful(near_sdk::serde_json::to_vec(&U128(live)).unwrap())],
            );
            let o = v.on_pool_quote(id, quote, lane, pred == acc(VAULT));
            ctx(pred, pk, ts, vec![]);
            o
        }
    }
}

fn run(v: &mut GuardVault, q: String, s: Base64VecU8) -> Outcome {
    run_with(v, q, s, None)
}

#[test]
fn agent_trades_autonomously_within_limits() {
    let mut v = setup();
    as_agent();
    let q = quote(200, TENTH, 1);
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.status, Status::Executed, "{}", o.detail);
    assert_eq!(v.get_spent_today().0, 200);
    assert_eq!(v.get_stats().executed, 1);
}

#[test]
fn over_per_trade_cap_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(50_000, TENTH, 1);
    let o = run(&mut v, q.clone(), sign(&q));
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.status, Status::Rejected);
    assert_eq!(o.check, "SIZE");
}

#[test]
fn forged_signature_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(200, TENTH, 1);
    let forged = SigningKey::from_bytes(&[9u8; 32]).sign(q.as_bytes()).to_bytes().to_vec();
    let o = run(&mut v, q, Base64VecU8(forged));
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
    let o = run(&mut v, edited, sig);
    assert_eq!(o.check, "GUARD_SIGNATURE");
}

#[test]
fn replayed_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 42);
    assert_eq!(run(&mut v, q.clone(), sign(&q)).status, Status::Executed);
    let o = run(&mut v, q.clone(), sign(&q));
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
        let o = run(&mut v, q.clone(), sign(&q));
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "ALLOWLIST");
}

#[test]
fn unlisted_venue_is_rejected() {
    // Even a guard-signed quote can't send funds to an attacker's "venue".
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 12 / 10, 1).replace(&format!("\"venue\":\"{}\"", REF), &format!("\"venue\":\"{}\"", ATTACKER));
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "VENUE");
}

#[test]
fn high_cost_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace("\"cost_bps\":10", "\"cost_bps\":400");
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "COST");
}

#[test]
fn quote_for_another_vault_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace(VAULT, "other-vault.testnet");
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "QUOTE_VAULT");
}

#[test]
fn expired_quote_is_rejected() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace("999999999", "5");
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "QUOTE_EXPIRED");
}

#[test]
fn above_threshold_waits_for_owner_then_executes() {
    let mut v = setup();
    as_agent();
    let q = quote(450, TENTH, 1);
    let o = run(&mut v, q.clone(), sign(&q));
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "KILL_SWITCH");
}

#[test]
#[should_panic(expected = "Only the vault's agent key or the owner can execute trades")]
fn outsider_cannot_execute() {
    let mut v = setup();
    as_account(ATTACKER);
    let q = quote(100, TENTH, 1);
    run(&mut v, q.clone(), sign(&q));
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
    run(&mut v, q.clone(), sign(&q));
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn agent_cannot_withdraw() {
    let mut v = setup();
    as_agent();
    v.request_withdraw(acc(NEAR_TOKEN), U128(TENTH));
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
    let _ = v.set_agent_key(other_pk(), None);
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.status, Status::Executed, "{}", o.detail);
}

#[test]
fn swap_below_the_price_floor_is_refused_even_when_signed() {
    // A leaked guard key signs a swap that accepts half the market rate.
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 62 / 100, 1);
    let o = run(&mut v, q.clone(), sign(&q));
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "PRICE_FLOOR");
}

#[test]
fn swap_without_minimum_output_is_refused() {
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, 0, 1);
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "MIN_OUTPUT");
}

#[test]
fn wrap_must_be_one_to_one() {
    let mut v = setup();
    as_agent();
    let q = quote(100, TENTH, 1).replace(&format!("\"min_amount_out\":\"{}\"", TENTH), "\"min_amount_out\":\"1\"");
    let o = run(&mut v, q.clone(), sign(&q));
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
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "GUARD_SIGNATURE");
    let ok = Base64VecU8(new_guard.sign(q.as_bytes()).to_bytes().to_vec());
    let q2 = quote(100, TENTH, 2);
    let ok2 = Base64VecU8(new_guard.sign(q2.as_bytes()).to_bytes().to_vec());
    let _ = ok;
    assert_eq!(run(&mut v, q2, ok2).status, Status::Executed);
}

#[test]
fn withdrawals_wait_for_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let w = v.request_withdraw(acc(NEAR_TOKEN), U128(TENTH));
    assert_eq!(v.get_pending_withdrawals().len(), 1);
    at_time(OWNER, 1_000 + TIMELOCK);
    let _ = v.apply_withdraw(w.id);
    assert!(v.get_pending_withdrawals().is_empty());
}

#[test]
#[should_panic(expected = "Timelock has not passed yet")]
fn withdrawal_cannot_skip_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let w = v.request_withdraw(acc(NEAR_TOKEN), U128(TENTH));
    at_time(OWNER, 1_000 + TIMELOCK - 1);
    let _ = v.apply_withdraw(w.id);
}

#[test]
fn stolen_owner_key_drain_is_vetoed_by_the_guardian() {
    let mut v = setup();
    as_account(OWNER); // the attacker, holding the owner key
    let w = v.request_withdraw(acc(NEAR_TOKEN), U128(5 * TENTH));
    as_account(GUARDIAN);
    v.cancel_withdraw(w.id);
    v.pause();
    assert!(v.get_pending_withdrawals().is_empty());
    assert!(v.get_policy().kill_switch);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn guardian_cannot_withdraw() {
    let mut v = setup();
    as_account(GUARDIAN);
    v.request_withdraw(acc(NEAR_TOKEN), U128(TENTH));
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn guardian_cannot_resume_trading() {
    let mut v = setup();
    as_account(GUARDIAN);
    v.pause();
    v.set_kill_switch(false);
}

#[test]
fn guardian_can_veto_a_loosening_change() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.allowed_venues.push(acc(ATTACKER));
    assert_eq!(v.set_policy(p), "QUEUED");
    as_account(GUARDIAN);
    v.cancel_policy();
    assert!(v.get_pending_policy().is_none());
}

#[test]
fn owner_can_exit_to_stable_during_a_crash() {
    // Paused: the owner can still exit at once, within 10% of the last good rate.
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 124 / 100, 1); // guard-signed at 1.24
    assert_eq!(run(&mut v, q.clone(), sign(&q)).status, Status::Executed);
    assert_eq!(v.get_last_rates()[0].out_per_in_e6.0, 1_240_000);
    as_account(OWNER);
    v.set_kill_switch(true);
    // 1.12 is under the 1.15 floor but within 10% of 1.24.
    v.exit_to_stable(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH * 112 / 100));
    assert_eq!(v.get_events().first().unwrap().check, "EXIT");
}

#[test]
#[should_panic(expected = "EXIT_FLOOR")]
fn stolen_owner_key_cannot_dump_at_a_pushed_price() {
    // An attacker with the owner key pushes the pool, then tries to exit at half price.
    let mut v = setup();
    as_agent();
    let q = swap(TENTH, TENTH * 124 / 100, 1);
    run(&mut v, q.clone(), sign(&q));
    as_account(OWNER);
    v.exit_to_stable(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH / 2));
}

#[test]
#[should_panic(expected = "EXIT_FLOOR")]
fn exit_without_a_trade_uses_the_floor() {
    let mut v = setup();
    as_account(OWNER);
    // No trade yet: the reference is the 1.15 floor, so 1.00 is more than 10% under.
    v.exit_to_stable(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH));
}

#[test]
fn deep_exit_needs_the_guardian() {
    let mut v = setup();
    as_account(OWNER);
    let e = v.request_exit(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH / 2));
    assert_eq!(v.get_pending_exits().len(), 1);
    as_account(GUARDIAN);
    v.approve_exit(e.id);
    assert!(v.get_pending_exits().is_empty());
    assert_eq!(v.get_events().first().unwrap().check, "EXIT_DEEP");
}

#[test]
#[should_panic(expected = "Timelock has not passed yet")]
fn deep_exit_cannot_skip_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let e = v.request_exit(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH / 2));
    v.apply_exit(e.id);
}

#[test]
#[should_panic(expected = "Only the guardian can approve an exit")]
fn owner_cannot_approve_own_deep_exit() {
    let mut v = setup();
    as_account(OWNER);
    let e = v.request_exit(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH / 2));
    v.approve_exit(e.id);
}

#[test]
fn guardian_can_cancel_a_deep_exit() {
    let mut v = setup();
    as_account(OWNER);
    let e = v.request_exit(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(TENTH / 2));
    as_account(GUARDIAN);
    v.cancel_exit(e.id);
    assert!(v.get_pending_exits().is_empty());
}

#[test]
#[should_panic(expected = "token_out is not an exit token")]
fn exit_only_into_exit_tokens() {
    let mut v = setup();
    as_account(OWNER);
    v.exit_to_stable(acc(REF), 1084, acc(USDT), acc(WRAP), U128(TENTH), U128(1));
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn agent_cannot_exit() {
    let mut v = setup();
    as_agent();
    v.exit_to_stable(acc(REF), 1084, acc(WRAP), acc(USDT), U128(TENTH), U128(1));
}

#[test]
#[should_panic(expected = "Agent gas budget is capped at 5 NEAR")]
fn agent_gas_budget_is_capped() {
    let mut v = setup();
    as_account(OWNER);
    let _ = v.set_agent_key(agent_pk(), Some(U128(6 * 10u128.pow(24))));
}

// ----------------------------------------------------------------------
// v6: trading-specific defenses
// ----------------------------------------------------------------------

fn swap_q(min_out: u128, nonce: u64, usd: u64) -> String {
    near_sdk::serde_json::json!({
        "vault": VAULT,
        "kind": { "RefSwap": { "pool_id": 1084 } },
        "token_in": WRAP,
        "token_out": USDT,
        "amount_in": TENTH.to_string(),
        "min_amount_out": min_out.to_string(),
        "venue": REF,
        "usd_cents": usd.to_string(),
        "cost_bps": 30,
        "nonce": nonce.to_string(),
        "expires_at_ms": "999999999",
    })
    .to_string()
}

fn at(ms: u64, pk: PublicKey) {
    ctx(acc(VAULT), pk, ms * 1_000_000, vec![]);
}

#[test]
fn pool_quote_refuses_a_loose_minimum_the_guard_signed() {
    // Above the owner's floor, but 3% under what the pool pays right now.
    let mut v = setup();
    as_agent();
    let min = TENTH * 124 / 100;
    let q = swap_q(min, 1, 200);
    let o = run_with(&mut v, q.clone(), sign(&q), Some(min * 103 / 100));
    assert_eq!(o.check, "POOL_QUOTE", "{}", o.detail);
    assert_eq!(o.status, Status::Rejected);
    assert_eq!(v.get_spent_today().0, 0);
}

#[test]
#[allow(deprecated)]
fn swap_is_not_sent_when_the_pool_cannot_be_read() {
    let mut v = setup();
    as_agent();
    let q = swap_q(TENTH * 124 / 100, 1, 200);
    let PromiseOrValue::Promise(_) = v.execute(q.clone(), sign(&q)) else { panic!("swap should ask the pool") };
    ctx(acc(VAULT), agent_pk(), 1_000 * 1_000_000, vec![near_sdk::PromiseResult::Failed]);
    let o = v.on_pool_quote(U64(1), near_sdk::serde_json::from_str(&q).unwrap(), 0, true);
    assert_eq!(o.check, "POOL_QUOTE");
    assert_eq!(v.get_stats().executed, 0);
}

#[test]
fn price_shock_waits_for_the_owner() {
    let mut v = setup();
    as_agent();
    let q1 = swap_q(TENTH * 124 / 100, 1, 200);
    assert_eq!(run(&mut v, q1.clone(), sign(&q1)).status, Status::Executed);
    // The pool now pays 12% more than the vault's reference: a pushed pool or a stale world.
    let min2 = TENTH * 139 / 100;
    let q2 = swap_q(min2, 2, 200);
    let o = run_with(&mut v, q2.clone(), sign(&q2), Some(min2 / 1000 * 1005));
    assert_eq!(o.check, "PRICE_SHOCK", "{}", o.detail);
    assert_eq!(o.status, Status::PendingApproval);
    assert_eq!(v.get_pending().len(), 1);
}

#[test]
fn leak_budget_stops_a_slow_bleed_of_fair_looking_trades() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.leak_budget_usd_cents = U64(5);
    v.set_policy(p);
    as_agent();
    // Each trade gives up 0.9% of the live quote: inside the 1% slippage limit, so it looks fair.
    let min = TENTH * 124 / 100;
    let live = min * 10_000 / 9_910;
    let q1 = swap_q(min, 1, 300);
    assert_eq!(run_with(&mut v, q1.clone(), sign(&q1), Some(live)).status, Status::Executed);
    let q2 = swap_q(min, 2, 300);
    let o = run_with(&mut v, q2.clone(), sign(&q2), Some(live));
    assert_eq!(o.check, "LEAK_BUDGET", "{}", o.detail);
}

#[test]
fn refusals_cut_autonomy_and_it_recovers() {
    let mut v = setup();
    as_agent();
    // Two refused attacks by this key.
    for n in 1..=2 {
        let q = quote(50_000, TENTH, n);
        assert_eq!(run(&mut v, q.clone(), sign(&q)).check, "SIZE");
    }
    assert_eq!(v.get_lanes()[0].strikes, 2);
    assert_eq!(v.get_lanes()[0].autonomy_usd_cents.0, 75);
    // A $2 trade the agent could normally make alone now waits for the owner.
    let q = quote(200, TENTH, 3);
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.status, Status::PendingApproval, "{}", o.detail);
    // Thirty minutes later both strikes have worn off.
    at(1_000 + 30 * 60_000, agent_pk());
    let q = quote(200, TENTH, 4);
    assert_eq!(run(&mut v, q.clone(), sign(&q)).status, Status::Executed);
}

fn challenge_guard() -> SigningKey {
    SigningKey::from_bytes(&[9u8; 32])
}

fn with_challenge() -> GuardVault {
    let mut v = setup();
    v.challenge_key = Some(other_pk());
    v.challenge_guard_key = Some(challenge_guard().verifying_key().to_bytes().to_vec());
    v
}

#[test]
fn challenge_keys_trade_in_their_own_lane() {
    let mut v = with_challenge();
    at(1_000, other_pk());
    let q = quote(200, TENTH, 1);
    let s = Base64VecU8(challenge_guard().sign(q.as_bytes()).to_bytes().to_vec());
    assert_eq!(run(&mut v, q, s).status, Status::Executed);
    assert_eq!(v.get_lanes()[1].spent_today_cents.0, 200);
    assert_eq!(v.get_spent_today().0, 0, "the real agent's limits are untouched");
}

#[test]
fn challenge_keys_cannot_use_the_real_guard() {
    let mut v = with_challenge();
    at(1_000, other_pk());
    let q = quote(200, TENTH, 1);
    let o = run(&mut v, q.clone(), sign(&q));
    assert_eq!(o.check, "GUARD_SIGNATURE");
    assert_eq!(v.get_lanes()[1].strikes, 1);
    assert_eq!(v.get_lanes()[0].strikes, 0, "challenge refusals don't cost the real agent");
}

#[test]
fn challenge_lane_has_its_own_daily_cap() {
    let mut v = with_challenge();
    at(1_000, other_pk());
    let mut total = 0;
    for n in 1..=4 {
        let q = quote(250, TENTH, n);
        let s = Base64VecU8(challenge_guard().sign(q.as_bytes()).to_bytes().to_vec());
        let o = run(&mut v, q, s);
        if o.status == Status::Executed {
            total += 250;
        } else {
            assert_eq!(o.check, "DAILY_CAP");
        }
    }
    assert_eq!(total, 500, "$6 challenge cap allows two $2.50 trades");
}

#[test]
fn loosening_the_new_defenses_waits_for_the_timelock() {
    let mut v = setup();
    as_account(OWNER);
    let mut p = policy();
    p.max_slippage_bps = 500;
    assert_eq!(v.set_policy(p), "QUEUED");
    let mut p = policy();
    p.leak_budget_usd_cents = U64(10_000);
    assert_eq!(v.set_policy(p), "QUEUED");
}
