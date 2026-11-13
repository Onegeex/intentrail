//! IntentRail GuardVault
//!
//! A NEAR account that holds an AI agent's trading funds and enforces the
//! trading policy on-chain. The design goal: an agent can trade, but cannot
//! drain the wallet, even if the agent, its prompt, or its key is compromised.
//!
//! How enforcement works
//! 1. The vault account has no full-access key. Only this contract's code
//!    can move its funds.
//! 2. The agent holds a function-call access key *on the vault account*,
//!    installed by the contract itself, that may call only `execute`. NEAR's
//!    protocol stops that key from transferring tokens, deleting the account,
//!    adding keys or calling any other contract.
//! 3. `execute` accepts a trade only with a quote signed by the IntentRail
//!    guard key. The guard server prices the trade from a real quote and
//!    computes fees, slippage and loss itself; the agent can't self-report them.
//! 4. Independently of the guard, the contract enforces hard limits the
//!    owner sets: kill switch, token and venue allowlists, per-token raw
//!    amount caps, a USD per-trade cap, a USD daily cap, and owner approval
//!    above a threshold. A compromised guard key still can't exceed them.
//! 5. Every trade shape returns its output to the vault. There is no
//!    recipient field, so output can't be routed to another account.
//! 6. Swaps carry a minimum output that the DEX enforces atomically, and the
//!    owner sets a price floor per pair that the contract checks without
//!    trusting the guard. A leaked guard key can lose at most the gap between
//!    the floor and the market on a capped trade.
//! 7. Changes that loosen the policy (raise a cap, add a token, turn trading
//!    back on) wait for a timelock. Changes that tighten it apply at once.
//! 8. Withdrawals wait for the same timelock. A separate guardian account can
//!    pause trading and veto anything queued, but can never move funds. A
//!    stolen owner key alone can't drain the vault before the guardian sees it.
//! 9. In a crash the owner can swap into an exit token (a stablecoin) at once,
//!    down to an exit floor. The funds stay in the vault.
//! 10. Trading-specific defenses, checked against the venue itself rather than
//!    the guard: before every swap the contract asks Ref Finance for the live
//!    pool quote. A minimum output that gives away more than `max_slippage_bps`
//!    of it is refused (POOL_QUOTE). A live price far from the vault's own
//!    on-chain reference price is held for the owner (PRICE_SHOCK). Each key
//!    has a daily budget for value given up against that reference
//!    (LEAK_BUDGET), so many small "fair" trades can't bleed the vault.
//! 11. Refusals cost trust: every refused trade halves what that key may do
//!    without the owner, recovering over time.
//! 12. A second, published key pair (challenge agent + challenge guard) lets
//!    anyone attack the vault with both keys in hand, under its own caps.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    PromiseResult, PublicKey,
};

const NEAR_TOKEN: &str = "near";
const DAY_MS: u64 = 86_400_000;
const MAX_EVENTS: usize = 25;
const GAS_FOR_CALL: Gas = Gas::from_tgas(60);
/// ft_transfer_call -> Ref swap -> transfer the output back needs room.
const GAS_FOR_SWAP: Gas = Gas::from_tgas(200);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
/// Ref's get_return view.
const GAS_FOR_POOL_VIEW: Gas = Gas::from_tgas(10);
/// What on_pool_quote needs to dispatch a swap and its callback.
const GAS_FOR_POOL_CB_MIN: Gas = Gas::from_tgas(230);
/// One refusal strike wears off after this long.
const STRIKE_DECAY_MS: u64 = 15 * 60_000;
const MAX_STRIKES: u32 = 8;
/// Lane 0: the agent (and the owner). Lane 1: the published challenge keys.
const LANE_AGENT: usize = 0;
const LANE_CHALLENGE: usize = 1;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Gas allowance attached to the agent key. Fees only; it can't move funds.
const DEFAULT_AGENT_ALLOWANCE: NearToken = NearToken::from_millinear(500);

/// What a trade does. Each shape returns its output to the vault.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum TradeKind {
    /// NEAR -> wNEAR: `near_deposit` on the wrap contract (venue).
    Wrap,
    /// wNEAR -> NEAR: `near_withdraw` on the wrap contract (venue = token_in).
    Unwrap,
    /// A Ref Finance instant swap in one pool. The contract writes the swap
    /// instruction itself, including `min_amount_out`; Ref sends the output
    /// back to the sender (the vault) or reverts the whole swap.
    RefSwap { pool_id: u64 },
}

/// A trade priced and signed by the IntentRail guard server.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Quote {
    pub vault: AccountId,
    pub kind: TradeKind,
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub amount_in: U128,
    pub min_amount_out: U128,
    pub venue: AccountId,
    /// USD value of amount_in in cents, from the guard's price source.
    pub usd_cents: U64,
    /// Fees + price impact the guard measured from the real quote, in bps.
    pub cost_bps: u32,
    pub nonce: U64,
    pub expires_at_ms: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    pub kill_switch: bool,
    pub allowed_tokens: Vec<AccountId>,
    pub allowed_venues: Vec<AccountId>,
    /// Raw per-trade caps per token (smallest units). A token with no cap is not tradable.
    pub max_amount_per_trade: Vec<(AccountId, U128)>,
    pub max_trade_usd_cents: U64,
    pub daily_cap_usd_cents: U64,
    /// Trades above this need the owner's approval. Below it the agent is autonomous.
    pub approval_above_usd_cents: U64,
    /// Highest fee + price impact the guard may sign for, in bps.
    pub max_cost_bps: u32,
    /// Owner-set minimum exchange rates for swaps, checked without the guard.
    /// A swap pair with no floor can't be traded.
    #[serde(default)]
    pub price_floors: Vec<PriceFloor>,
    /// Tokens the owner may exit into (stablecoins) even when paused.
    #[serde(default)]
    pub exit_tokens: Vec<AccountId>,
    /// How far under the last guard-signed rate the owner may exit alone, in bps.
    /// Deeper exits need the guardian, or wait out the timelock.
    #[serde(default = "default_exit_discount")]
    pub exit_max_discount_bps: u32,
    /// A swap's minimum output may give away at most this much of Ref's live quote.
    #[serde(default = "default_max_slippage")]
    pub max_slippage_bps: u32,
    /// A live price this far from the vault's reference price waits for the owner.
    #[serde(default = "default_shock")]
    pub shock_bps: u32,
    /// Per key, per day: value given up against the reference price, in USD cents.
    #[serde(default = "default_leak_budget")]
    pub leak_budget_usd_cents: U64,
    /// Daily cap for the published challenge keys.
    #[serde(default = "default_challenge_cap")]
    pub challenge_daily_cap_usd_cents: U64,
    /// Tokens worth $1 each, with their decimals. On swaps that touch one, the
    /// contract values the trade itself from the pool and uses the higher of
    /// that and the guard's figure, so a lying guard can't stretch the caps.
    #[serde(default)]
    pub usd_tokens: Vec<(AccountId, u8)>,
}

fn default_exit_discount() -> u32 {
    1_000
}
fn default_max_slippage() -> u32 {
    100
}
fn default_shock() -> u32 {
    300
}
fn default_leak_budget() -> U64 {
    U64(50)
}
fn default_challenge_cap() -> U64 {
    U64(2_000)
}

/// Per-key accounting.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Lane {
    pub day: u64,
    pub spent_today_cents: u64,
    pub leak_today_cents: u64,
    pub strikes: u32,
    pub strike_at_ms: u64,
}

/// The vault's own reference price for a pair: an average of Ref's live
/// quotes on the swaps it accepted.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PoolRef {
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub out_per_in_e6: U128,
    pub at_ms: U64,
}

#[near(serializers = [json])]
#[derive(Debug)]
pub struct LaneView {
    pub lane: String,
    pub spent_today_cents: U64,
    pub leak_today_cents: U64,
    pub strikes: u32,
    pub autonomy_usd_cents: U64,
}

/// `min_amount_out * 1e6 >= amount_in * min_out_per_in_e6`, in raw units.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceFloor {
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub min_out_per_in_e6: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingWithdrawal {
    pub id: U64,
    pub token: AccountId,
    pub amount: U128,
    pub eta_ms: U64,
}

/// An exit deeper than the owner may take alone.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingExit {
    pub id: U64,
    pub venue: AccountId,
    pub pool_id: u64,
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub amount: U128,
    pub min_amount_out: U128,
    pub eta_ms: U64,
}

/// The rate of the last swap the guard signed and the contract accepted,
/// as `min_amount_out * 1e6 / amount_in`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct LastRate {
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub out_per_in_e6: U128,
    pub at_ms: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingPolicy {
    pub policy: Policy,
    pub eta_ms: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Executed,
    Rejected,
    PendingApproval,
    Approved,
    Failed,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Event {
    pub id: U64,
    pub at_ms: U64,
    pub status: Status,
    /// Which check decided it, e.g. "DAILY_CAP". "OK" when it passed.
    pub check: String,
    pub detail: String,
    pub token_in: Option<AccountId>,
    pub amount_in: Option<U128>,
    pub usd_cents: Option<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingTrade {
    pub id: U64,
    pub kind: TradeKind,
    pub token_in: AccountId,
    pub token_out: AccountId,
    pub amount_in: U128,
    pub min_amount_out: U128,
    pub venue: AccountId,
    pub usd_cents: U64,
    pub created_ms: U64,
    #[serde(default)]
    pub lane: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub executed: u64,
    pub rejected: u64,
    pub pending: u64,
    pub failed: u64,
}

#[near(serializers = [json])]
#[derive(Debug)]
pub struct Outcome {
    pub id: U64,
    pub status: Status,
    pub check: String,
    pub detail: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GuardVault {
    owner: AccountId,
    /// Can pause and veto queued owner actions. Can't move funds or loosen anything.
    guardian: AccountId,
    /// ed25519 public key (32 bytes) of the IntentRail guard server.
    guard_key: Vec<u8>,
    agent_key: Option<PublicKey>,
    challenge_key: Option<PublicKey>,
    challenge_guard_key: Option<Vec<u8>>,
    policy: Policy,
    lanes: Vec<Lane>,
    pool_refs: Vec<PoolRef>,
    used_nonces: LookupSet<u64>,
    pending: IterableMap<u64, PendingTrade>,
    next_id: u64,
    stats: Stats,
    events: Vec<Event>,
    /// How long a loosening policy change waits before it can apply.
    timelock_ms: u64,
    pending_policy: Option<PendingPolicy>,
    pending_withdrawals: Vec<PendingWithdrawal>,
    pending_exits: Vec<PendingExit>,
    last_rates: Vec<LastRate>,
}

#[near]
impl GuardVault {
    #[init]
    pub fn new(owner: AccountId, guardian: AccountId, guard_key: Base64VecU8, policy: Policy, timelock_ms: U64) -> Self {
        require!(owner != guardian, "Owner and guardian must be different accounts");
        require!(guard_key.0.len() == 32, "guard_key must be a 32-byte ed25519 public key");
        Self::assert_policy(&policy);
        Self {
            owner,
            guardian,
            guard_key: guard_key.0,
            agent_key: None,
            challenge_key: None,
            challenge_guard_key: None,
            policy,
            lanes: vec![Lane { day: env::block_timestamp_ms() / DAY_MS, ..Default::default() }; 2],
            pool_refs: Vec::new(),
            used_nonces: LookupSet::new(b"n"),
            pending: IterableMap::new(b"p"),
            next_id: 1,
            stats: Stats::default(),
            events: Vec::new(),
            timelock_ms: timelock_ms.0,
            pending_policy: None,
            pending_withdrawals: Vec::new(),
            pending_exits: Vec::new(),
            last_rates: Vec::new(),
        }
    }

    // ------------------------------------------------------------------
    // Agent entry point
    // ------------------------------------------------------------------

    /// Execute a guard-signed trade. Callable only by the agent's
    /// function-call key on this account, or by the owner.
    ///
    /// `quote_json` is the exact string the guard signed; `signature` is the
    /// 64-byte ed25519 signature over its UTF-8 bytes.
    pub fn execute(&mut self, quote_json: String, signature: Base64VecU8) -> PromiseOrValue<Outcome> {
        let (strike_lane, lane, guard_key) = self.caller_lane();
        self.roll_day();
        let id = self.take_id();
        let v = |o: Outcome| PromiseOrValue::Value(o);

        if self.policy.kill_switch {
            return v(self.reject_in(strike_lane, id, "KILL_SWITCH", "The owner has stopped all trading.", None));
        }

        // 1. The guard must have signed exactly this quote.
        let sig: [u8; 64] = match signature.0.as_slice().try_into() {
            Ok(s) => s,
            Err(_) => return v(self.reject_in(strike_lane, id, "GUARD_SIGNATURE", "Signature is not 64 bytes.", None)),
        };
        let pk: [u8; 32] = guard_key.as_slice().try_into().unwrap();
        if !env::ed25519_verify(&sig, quote_json.as_bytes(), &pk) {
            return v(self.reject_in(
                strike_lane,
                id,
                "GUARD_SIGNATURE",
                "Quote is not signed by the IntentRail guard key.",
                None,
            ));
        }
        let q: Quote = match near_sdk::serde_json::from_str(&quote_json) {
            Ok(q) => q,
            Err(_) => return v(self.reject_in(strike_lane, id, "QUOTE_FORMAT", "Signed quote is not valid JSON.", None)),
        };

        // 2. Bound to this vault, fresh, and single-use.
        if q.vault != env::current_account_id() {
            return v(self.reject_in(strike_lane, id, "QUOTE_VAULT", "Quote was signed for a different vault.", Some(&q)));
        }
        if env::block_timestamp_ms() > q.expires_at_ms.0 {
            return v(self.reject_in(strike_lane, id, "QUOTE_EXPIRED", "Quote has expired.", Some(&q)));
        }
        if self.used_nonces.contains(&q.nonce.0) {
            return v(self.reject_in(strike_lane, id, "QUOTE_REPLAY", "Quote was already used.", Some(&q)));
        }

        // 3. Hard limits the guard can't override.
        self.used_nonces.insert(q.nonce.0);
        if let Err((check, detail)) = self.check_limits(&q, lane) {
            return v(self.reject_in(strike_lane, id, check, &detail, Some(&q)));
        }

        // 4. Swaps: ask the venue itself what this trade pays right now.
        if let TradeKind::RefSwap { pool_id } = q.kind {
            let budget = env::prepaid_gas()
                .saturating_sub(env::used_gas())
                .saturating_sub(GAS_FOR_POOL_VIEW)
                .saturating_sub(Gas::from_tgas(20));
            if budget < GAS_FOR_POOL_CB_MIN {
                return v(self.reject_in(None, id, "GAS", "Attach 300 Tgas so the contract can check the pool before swapping.", Some(&q)));
            }
            let view = Promise::new(q.venue.clone()).function_call(
                "get_return".to_string(),
                near_sdk::serde_json::json!({
                    "pool_id": pool_id,
                    "token_in": q.token_in,
                    "amount_in": q.amount_in,
                    "token_out": q.token_out,
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_POOL_VIEW,
            );
            let cb = Promise::new(env::current_account_id()).function_call(
                "on_pool_quote".to_string(),
                near_sdk::serde_json::json!({
                    "id": U64(id),
                    "quote": q,
                    "lane": lane as u8,
                    "strike": strike_lane.is_some(),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                budget,
            );
            return PromiseOrValue::Promise(view.then(cb));
        }

        // Wrap / unwrap: 1:1, nothing to price.
        v(self.finish(id, &q, lane, 0))
    }

    /// Second half of a swap, with Ref's live quote in hand.
    #[private]
    #[allow(deprecated)]
    pub fn on_pool_quote(&mut self, id: U64, quote: Quote, lane: u8, strike: bool) -> Outcome {
        let q = quote;
        let lane = lane as usize;
        let strike_lane = if strike { Some(lane) } else { None };
        self.roll_day();
        let live_out = match env::promise_result(0) {
            PromiseResult::Successful(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).ok().map(|x| x.0),
            PromiseResult::Failed => None,
        };
        let Some(live_out) = live_out.filter(|x| *x > 0) else {
            return self.reject_in(None, id.0, "POOL_QUOTE", "Couldn't read a live quote from the pool, so the swap was not sent.", Some(&q));
        };
        let p = &self.policy;
        // Value the trade from the venue when one side is a dollar token.
        let usd_of = |t: &AccountId, raw: u128| -> Option<u64> {
            p.usd_tokens.iter().find(|(u, _)| u == t).map(|(_, d)| (raw.saturating_mul(100) / 10u128.pow(*d as u32)) as u64)
        };
        let onchain_usd = usd_of(&q.token_out, live_out).or_else(|| usd_of(&q.token_in, q.amount_in.0));
        let usd = onchain_usd.unwrap_or(0).max(q.usd_cents.0);
        if usd > p.max_trade_usd_cents.0 {
            let detail = format!(
                "The pool values this trade at ${}, over the ${} per-trade cap.",
                cents(usd), cents(p.max_trade_usd_cents.0)
            );
            return self.reject_in(strike_lane, id.0, "SIZE", &detail, Some(&q));
        }

        // POOL_QUOTE: the minimum output can't give away more than max_slippage_bps of the live quote.
        if q.min_amount_out.0.saturating_mul(10_000) < live_out.saturating_mul(10_000 - p.max_slippage_bps.min(10_000) as u128) {
            let give = (live_out - q.min_amount_out.0.min(live_out)) * 10_000 / live_out;
            let detail = format!(
                "The signed minimum output gives away {}.{:02}% of what the pool pays right now. The limit is {}.{:02}%.",
                give / 100, give % 100, p.max_slippage_bps / 100, p.max_slippage_bps % 100
            );
            return self.reject_in(strike_lane, id.0, "POOL_QUOTE", &detail, Some(&q));
        }

        let live_rate = live_out.saturating_mul(1_000_000) / q.amount_in.0.max(1);
        let min_rate = q.min_amount_out.0.saturating_mul(1_000_000) / q.amount_in.0.max(1);
        let reference = self.pool_ref(&q.token_in, &q.token_out);

        // PRICE_SHOCK: a live price far from the vault's own reference waits for the owner.
        if let Some(r) = reference {
            let dev = if live_rate > r { live_rate - r } else { r - live_rate } * 10_000 / r.max(1);
            if dev > p.shock_bps as u128 {
                let detail = format!(
                    "The pool's price is {}.{:02}% away from the vault's reference price. The owner decides.",
                    dev / 100, dev % 100
                );
                return self.hold(id.0, &q, lane, "PRICE_SHOCK", &detail);
            }
        }

        // LEAK_BUDGET: value given up per key, per day, measured against the
        // higher of the reference and the live price, so a rising market
        // can't hide it.
        let r = reference.map(|x| x.max(live_rate)).unwrap_or(live_rate);
        let give_bps = if r > min_rate { (r - min_rate) * 10_000 / r } else { 0 };
        let give_cents = ((usd as u128 * give_bps + 9_999) / 10_000) as u64;
        let budget = p.leak_budget_usd_cents.0;
        if self.lanes[lane].leak_today_cents + give_cents > budget {
            let detail = format!(
                "This trade gives up ${} against the reference price. Today this key has given up ${} of its ${} budget.",
                cents(give_cents), cents(self.lanes[lane].leak_today_cents), cents(budget)
            );
            return self.reject_in(strike_lane, id.0, "LEAK_BUDGET", &detail, Some(&q));
        }
        // The cap may have moved while the pool answered.
        if self.lanes[lane].spent_today_cents + usd > self.lane_cap(lane) {
            return self.reject_in(strike_lane, id.0, "DAILY_CAP", "This trade, valued by the pool, would pass today's cap.", Some(&q));
        }

        self.update_pool_ref(&q.token_in, &q.token_out, live_rate);
        self.record_rate(&q.token_in, &q.token_out, q.amount_in, q.min_amount_out);
        let mut q = q;
        q.usd_cents = U64(usd);
        self.finish(id.0, &q, lane, give_cents)
    }

    // ------------------------------------------------------------------
    // Owner controls
    // ------------------------------------------------------------------

    pub fn approve(&mut self, id: U64) -> Outcome {
        self.assert_owner();
        self.roll_day();
        let p = self.pending.remove(&id.0).unwrap_or_else(|| env::panic_str("No pending trade with that id"));
        self.stats.pending = self.stats.pending.saturating_sub(1);
        if self.policy.kill_switch {
            self.log_event(id.0, Status::Cancelled, "KILL_SWITCH", "Kill switch is on.", None);
            return Outcome { id, status: Status::Cancelled, check: "KILL_SWITCH".into(), detail: "Kill switch is on.".into() };
        }
        let lane = p.lane as usize;
        if self.lanes[lane].spent_today_cents + p.usd_cents.0 > self.lane_cap(lane) {
            self.log_event(id.0, Status::Cancelled, "DAILY_CAP", "Would exceed today's cap.", None);
            return Outcome { id, status: Status::Cancelled, check: "DAILY_CAP".into(), detail: "Would exceed today's cap.".into() };
        }
        self.lanes[lane].spent_today_cents += p.usd_cents.0;
        self.dispatch(id.0, &p.kind, &p.token_in, &p.token_out, p.amount_in, p.min_amount_out, &p.venue, p.usd_cents.0, lane);
        self.stats.executed += 1;
        let detail = format!("Owner approved. ${} sent to {}.", cents(p.usd_cents.0), p.venue);
        self.log_event(id.0, Status::Approved, "OWNER_APPROVAL", &detail, None);
        Outcome { id, status: Status::Approved, check: "OWNER_APPROVAL".into(), detail }
    }

    pub fn cancel(&mut self, id: U64) {
        self.assert_owner();
        if self.pending.remove(&id.0).is_some() {
            self.stats.pending = self.stats.pending.saturating_sub(1);
            self.log_event(id.0, Status::Cancelled, "OWNER_APPROVAL", "Owner declined.", None);
        }
    }

    /// Turning the kill switch on is instant. Turning it off is a loosening
    /// change, so it waits for the timelock like any other.
    pub fn set_kill_switch(&mut self, on: bool) -> String {
        self.assert_owner();
        let mut p = self.policy.clone();
        p.kill_switch = on;
        self.set_policy(p)
    }

    /// Tightening changes apply now. Loosening changes are queued and can be
    /// applied after `timelock_ms`. Returns "APPLIED" or "QUEUED".
    pub fn set_policy(&mut self, policy: Policy) -> String {
        self.assert_owner();
        Self::assert_policy(&policy);
        if Self::is_no_looser(&policy, &self.policy) {
            self.policy = policy;
            self.pending_policy = None;
            self.log_event(0, Status::Executed, "POLICY", "Owner tightened the policy. Applied at once.", None);
            "APPLIED".into()
        } else {
            let eta = env::block_timestamp_ms() + self.timelock_ms;
            self.pending_policy = Some(PendingPolicy { policy, eta_ms: U64(eta) });
            let detail = format!("Owner loosened the policy. It can apply in {} minutes.", self.timelock_ms / 60_000);
            self.log_event(0, Status::PendingApproval, "TIMELOCK", &detail, None);
            "QUEUED".into()
        }
    }

    pub fn apply_policy(&mut self) {
        self.assert_owner();
        let pp = self.pending_policy.take().unwrap_or_else(|| env::panic_str("No queued policy"));
        require!(env::block_timestamp_ms() >= pp.eta_ms.0, "Timelock has not passed yet");
        self.policy = pp.policy;
        self.log_event(0, Status::Approved, "TIMELOCK", "Queued policy applied after the timelock.", None);
    }

    /// Owner or guardian can drop a queued policy change.
    pub fn cancel_policy(&mut self) {
        self.assert_owner_or_guardian();
        if self.pending_policy.take().is_some() {
            self.log_event(0, Status::Cancelled, "TIMELOCK", "Queued policy change cancelled.", None);
        }
    }

    /// Guardian (or owner) stops all trading at once. Only the owner can
    /// resume, and resuming waits for the timelock.
    pub fn pause(&mut self) {
        self.assert_owner_or_guardian();
        self.policy.kill_switch = true;
        self.log_event(0, Status::Executed, "KILL_SWITCH", "Trading paused.", None);
    }

    pub fn set_guard_key(&mut self, guard_key: Base64VecU8) {
        self.assert_owner();
        require!(guard_key.0.len() == 32, "guard_key must be 32 bytes");
        self.guard_key = guard_key.0;
    }

    /// Install (or rotate) the agent's key: a function-call key on this
    /// account that can call only `execute`, with a fee allowance and no
    /// ability to transfer tokens.
    /// Re-installing the same key refreshes its gas budget.
    pub fn set_agent_key(&mut self, public_key: PublicKey, allowance: Option<U128>) -> Promise {
        self.assert_owner();
        let allowance = allowance.map(|a| NearToken::from_yoctonear(a.0)).unwrap_or(DEFAULT_AGENT_ALLOWANCE);
        require!(allowance <= NearToken::from_near(5), "Agent gas budget is capped at 5 NEAR");
        let me = env::current_account_id();
        let mut p = Promise::new(me.clone());
        if let Some(old) = self.agent_key.take() {
            p = p.delete_key(old);
        }
        self.agent_key = Some(public_key.clone());
        p.add_access_key_allowance(
            public_key,
            near_sdk::Allowance::limited(allowance).unwrap(),
            me,
            "execute".to_string(),
        )
    }

    /// Publish a second key pair anyone may use to attack the vault: a
    /// function-call key for `execute` and the guard key that signs its quotes.
    /// It trades under the same policy, with its own daily cap, leak budget and
    /// strikes, so it can't use up the real agent's limits.
    pub fn set_challenge(&mut self, public_key: PublicKey, guard_key: Base64VecU8, allowance: Option<U128>) -> Promise {
        self.assert_owner();
        require!(guard_key.0.len() == 32, "guard_key must be 32 bytes");
        let allowance = allowance.map(|a| NearToken::from_yoctonear(a.0)).unwrap_or(DEFAULT_AGENT_ALLOWANCE);
        require!(allowance <= NearToken::from_near(5), "Gas budget is capped at 5 NEAR");
        let me = env::current_account_id();
        let mut p = Promise::new(me.clone());
        if let Some(old) = self.challenge_key.take() {
            p = p.delete_key(old);
        }
        self.challenge_key = Some(public_key.clone());
        self.challenge_guard_key = Some(guard_key.0);
        self.log_event(0, Status::Executed, "CHALLENGE", "Owner published a challenge key pair.", None);
        p.add_access_key_allowance(public_key, near_sdk::Allowance::limited(allowance).unwrap(), me, "execute".to_string())
    }

    /// Owner asks to take funds out, to the owner account only. It waits for
    /// the timelock, so the guardian has time to veto a stolen key.
    pub fn request_withdraw(&mut self, token: AccountId, amount: U128) -> PendingWithdrawal {
        self.assert_owner();
        require!(amount.0 > 0, "Amount must be positive");
        let id = self.take_id();
        let w = PendingWithdrawal {
            id: U64(id),
            token: token.clone(),
            amount,
            eta_ms: U64(env::block_timestamp_ms() + self.timelock_ms),
        };
        self.pending_withdrawals.push(w.clone());
        let detail = format!("Owner asked to withdraw {} of {}. It can go through in {} minutes.", amount.0, token, self.timelock_ms / 60_000);
        self.log_event(id, Status::PendingApproval, "WITHDRAW_TIMELOCK", &detail, None);
        w
    }

    pub fn apply_withdraw(&mut self, id: U64) -> Promise {
        self.assert_owner();
        let idx = self
            .pending_withdrawals
            .iter()
            .position(|w| w.id == id)
            .unwrap_or_else(|| env::panic_str("No queued withdrawal with that id"));
        require!(env::block_timestamp_ms() >= self.pending_withdrawals[idx].eta_ms.0, "Timelock has not passed yet");
        let w = self.pending_withdrawals.remove(idx);
        self.log_event(id.0, Status::Approved, "WITHDRAW_TIMELOCK", "Withdrawal sent to the owner after the timelock.", None);
        if w.token.as_str() == NEAR_TOKEN {
            Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(w.amount.0))
        } else {
            Promise::new(w.token).function_call(
                "ft_transfer".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": self.owner, "amount": w.amount })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FOR_CALL,
            )
        }
    }

    /// Owner or guardian can veto a queued withdrawal.
    pub fn cancel_withdraw(&mut self, id: U64) {
        self.assert_owner_or_guardian();
        let before = self.pending_withdrawals.len();
        self.pending_withdrawals.retain(|w| w.id != id);
        if self.pending_withdrawals.len() < before {
            self.log_event(id.0, Status::Cancelled, "WITHDRAW_TIMELOCK", "Queued withdrawal vetoed.", None);
        }
    }

    /// Crash exit: the owner swaps into an exit token at once, even when
    /// paused and below the price floors. Alone, the owner may go at most
    /// `exit_max_discount_bps` under the last guard-signed rate for the pair
    /// (or the price floor if there is none), so a stolen owner key can't dump
    /// the vault into a pool it has pushed. Deeper exits use `request_exit`.
    #[allow(clippy::too_many_arguments)]
    pub fn exit_to_stable(
        &mut self,
        venue: AccountId,
        pool_id: u64,
        token_in: AccountId,
        token_out: AccountId,
        amount: U128,
        min_amount_out: U128,
    ) {
        self.assert_owner();
        self.assert_exit_shape(&venue, &token_in, &token_out, min_amount_out);
        let reference = self
            .reference_rate(&token_in, &token_out)
            .unwrap_or_else(|| env::panic_str("EXIT_FLOOR: no guard-signed rate or floor for this pair. Use request_exit."));
        let disc = self.policy.exit_max_discount_bps as u128;
        let lhs = min_amount_out.0.checked_mul(1_000_000 * 10_000);
        let rhs = amount.0.checked_mul(reference).and_then(|x| x.checked_mul(10_000 - disc.min(10_000)));
        match (lhs, rhs) {
            (Some(l), Some(r)) if l >= r => {}
            _ => env::panic_str(&format!(
                "EXIT_FLOOR: more than {}% under the last guard-signed rate. Ask the guardian (request_exit).",
                disc as f64 / 100.0
            )),
        }
        let id = self.take_id();
        let detail = format!("Owner exited {} of {} into {}, within {}% of the last good rate.", amount.0, token_in, token_out, disc as f64 / 100.0);
        self.log_event(id, Status::Executed, "EXIT", &detail, None);
        self.dispatch(id, &TradeKind::RefSwap { pool_id }, &token_in, &token_out, amount, min_amount_out, &venue, 0, LANE_AGENT);
    }

    /// An exit at any price. It waits for the guardian's approval, or the timelock.
    #[allow(clippy::too_many_arguments)]
    pub fn request_exit(
        &mut self,
        venue: AccountId,
        pool_id: u64,
        token_in: AccountId,
        token_out: AccountId,
        amount: U128,
        min_amount_out: U128,
    ) -> PendingExit {
        self.assert_owner();
        self.assert_exit_shape(&venue, &token_in, &token_out, min_amount_out);
        let id = self.take_id();
        let e = PendingExit {
            id: U64(id),
            venue,
            pool_id,
            token_in,
            token_out,
            amount,
            min_amount_out,
            eta_ms: U64(env::block_timestamp_ms() + self.timelock_ms),
        };
        self.pending_exits.push(e.clone());
        self.log_event(id, Status::PendingApproval, "EXIT_DEEP", "Owner asked for a deep exit. The guardian can approve it now, or it waits out the timelock.", None);
        e
    }

    /// Guardian approves a queued deep exit straight away.
    pub fn approve_exit(&mut self, id: U64) {
        require!(env::predecessor_account_id() == self.guardian, "Only the guardian can approve an exit");
        self.run_exit(id, "Guardian approved the deep exit.");
    }

    /// Owner runs a queued deep exit once the timelock has passed.
    pub fn apply_exit(&mut self, id: U64) {
        self.assert_owner();
        let e = self.pending_exits.iter().find(|e| e.id == id).unwrap_or_else(|| env::panic_str("No queued exit with that id"));
        require!(env::block_timestamp_ms() >= e.eta_ms.0, "Timelock has not passed yet");
        self.run_exit(id, "Deep exit applied after the timelock.");
    }

    pub fn cancel_exit(&mut self, id: U64) {
        self.assert_owner_or_guardian();
        let before = self.pending_exits.len();
        self.pending_exits.retain(|e| e.id != id);
        if self.pending_exits.len() < before {
            self.log_event(id.0, Status::Cancelled, "EXIT_DEEP", "Queued deep exit cancelled.", None);
        }
    }

    /// Register this vault with a token contract so it can hold that token.
    #[payable]
    pub fn register_token(&mut self, token: AccountId) -> Promise {
        self.assert_owner();
        Promise::new(token).function_call(
            "storage_deposit".to_string(),
            near_sdk::serde_json::json!({ "account_id": env::current_account_id(), "registration_only": true })
                .to_string()
                .into_bytes(),
            env::attached_deposit(),
            GAS_FOR_CALL,
        )
    }

    // ------------------------------------------------------------------
    // Callbacks and token receiver
    // ------------------------------------------------------------------

    #[private]
    #[allow(deprecated)]
    pub fn on_dispatched(&mut self, id: U64, usd_cents: U64, lane: Option<u8>) {
        // ft_transfer_call reports how much the receiver kept. "0" means Ref
        // refused the swap (for example, below min_amount_out) and refunded it.
        let refunded = match env::promise_result(0) {
            PromiseResult::Failed => true,
            PromiseResult::Successful(bytes) => {
                matches!(near_sdk::serde_json::from_slice::<U128>(&bytes), Ok(U128(0)))
            }
        };
        if refunded {
            let l = lane.unwrap_or(0) as usize;
            self.lanes[l].spent_today_cents = self.lanes[l].spent_today_cents.saturating_sub(usd_cents.0);
            self.stats.failed += 1;
            self.stats.executed = self.stats.executed.saturating_sub(1);
            self.log_event(
                id.0,
                Status::Failed,
                "VENUE",
                "The venue didn't complete the trade (for example, below the minimum output), so the tokens came back. Nothing was spent.",
                None,
            );
        }
    }

    /// Accept token deposits into the vault.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let _ = (sender_id, amount, msg);
        U128(0)
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_policy(&self) -> &Policy {
        &self.policy
    }
    pub fn get_guardian(&self) -> &AccountId {
        &self.guardian
    }
    pub fn get_pending_exits(&self) -> &Vec<PendingExit> {
        &self.pending_exits
    }
    pub fn get_last_rates(&self) -> &Vec<LastRate> {
        &self.last_rates
    }
    pub fn get_pending_withdrawals(&self) -> &Vec<PendingWithdrawal> {
        &self.pending_withdrawals
    }
    pub fn get_pending_policy(&self) -> Option<&PendingPolicy> {
        self.pending_policy.as_ref()
    }
    pub fn get_timelock_ms(&self) -> U64 {
        U64(self.timelock_ms)
    }
    pub fn get_owner(&self) -> &AccountId {
        &self.owner
    }
    pub fn get_agent_key(&self) -> Option<&PublicKey> {
        self.agent_key.as_ref()
    }
    pub fn get_guard_key(&self) -> Base64VecU8 {
        Base64VecU8(self.guard_key.clone())
    }
    pub fn get_stats(&self) -> &Stats {
        &self.stats
    }
    pub fn get_spent_today(&self) -> U64 {
        let l = &self.lanes[LANE_AGENT];
        if env::block_timestamp_ms() / DAY_MS != l.day {
            U64(0)
        } else {
            U64(l.spent_today_cents)
        }
    }
    /// Spend, value given up, refusal strikes and current autonomy, per key.
    pub fn get_lanes(&self) -> Vec<LaneView> {
        let today = env::block_timestamp_ms() / DAY_MS;
        ["agent", "challenge"]
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let l = &self.lanes[i];
                let fresh = l.day == today;
                LaneView {
                    lane: name.to_string(),
                    spent_today_cents: U64(if fresh { l.spent_today_cents } else { 0 }),
                    leak_today_cents: U64(if fresh { l.leak_today_cents } else { 0 }),
                    strikes: self.effective_strikes(i),
                    autonomy_usd_cents: U64(self.autonomy(i)),
                }
            })
            .collect()
    }
    pub fn get_pool_refs(&self) -> &Vec<PoolRef> {
        &self.pool_refs
    }
    pub fn get_challenge(&self) -> (Option<&PublicKey>, Option<Base64VecU8>) {
        (self.challenge_key.as_ref(), self.challenge_guard_key.clone().map(Base64VecU8))
    }
    /// Most recent first.
    pub fn get_events(&self) -> Vec<Event> {
        self.events.iter().rev().cloned().collect()
    }
    pub fn get_pending(&self) -> Vec<PendingTrade> {
        self.pending.values().cloned().collect()
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// Hold for the owner, or execute, depending on this key's autonomy.
    fn finish(&mut self, id: u64, q: &Quote, lane: usize, give_cents: u64) -> Outcome {
        let limit = self.autonomy(lane);
        if q.usd_cents.0 > limit {
            let strikes = self.effective_strikes(lane);
            let detail = if strikes > 0 {
                format!(
                    "${} is above this key's ${} autonomy limit, cut from ${} by {} recent refusal{}. Waiting for the owner.",
                    cents(q.usd_cents.0), cents(limit), cents(self.policy.approval_above_usd_cents.0), strikes,
                    if strikes == 1 { "" } else { "s" }
                )
            } else {
                format!("${} is above the ${} autonomy limit. Waiting for the owner.", cents(q.usd_cents.0), cents(limit))
            };
            return self.hold(id, q, lane, "OWNER_APPROVAL", &detail);
        }
        self.lanes[lane].spent_today_cents += q.usd_cents.0;
        self.lanes[lane].leak_today_cents += give_cents;
        self.dispatch(id, &q.kind, &q.token_in, &q.token_out, q.amount_in, q.min_amount_out, &q.venue, q.usd_cents.0, lane);
        let detail = format!("Passed every check. ${} sent to {}.", cents(q.usd_cents.0), q.venue);
        self.log_event(id, Status::Executed, "OK", &detail, Some(q));
        self.stats.executed += 1;
        Outcome { id: U64(id), status: Status::Executed, check: "OK".into(), detail }
    }

    fn hold(&mut self, id: u64, q: &Quote, lane: usize, check: &str, detail: &str) -> Outcome {
        let p = PendingTrade {
            id: U64(id),
            kind: q.kind.clone(),
            token_in: q.token_in.clone(),
            token_out: q.token_out.clone(),
            amount_in: q.amount_in,
            min_amount_out: q.min_amount_out,
            venue: q.venue.clone(),
            usd_cents: q.usd_cents,
            created_ms: U64(env::block_timestamp_ms()),
            lane: lane as u8,
        };
        self.pending.insert(id, p);
        self.stats.pending += 1;
        self.log_event(id, Status::PendingApproval, check, detail, Some(q));
        Outcome { id: U64(id), status: Status::PendingApproval, check: check.into(), detail: detail.into() }
    }

    fn effective_strikes(&self, lane: usize) -> u32 {
        let l = &self.lanes[lane];
        let worn = (env::block_timestamp_ms().saturating_sub(l.strike_at_ms) / STRIKE_DECAY_MS) as u32;
        l.strikes.saturating_sub(worn)
    }

    /// The most this key may trade without the owner: halved per recent refusal.
    fn autonomy(&self, lane: usize) -> u64 {
        self.policy.approval_above_usd_cents.0 >> self.effective_strikes(lane).min(MAX_STRIKES)
    }

    fn lane_cap(&self, lane: usize) -> u64 {
        if lane == LANE_CHALLENGE {
            self.policy.challenge_daily_cap_usd_cents.0
        } else {
            self.policy.daily_cap_usd_cents.0
        }
    }

    fn pool_ref(&self, token_in: &AccountId, token_out: &AccountId) -> Option<u128> {
        self.pool_refs.iter().find(|r| &r.token_in == token_in && &r.token_out == token_out).map(|r| r.out_per_in_e6.0)
    }

    /// Moves a quarter of the way to the live price on each accepted swap.
    fn update_pool_ref(&mut self, token_in: &AccountId, token_out: &AccountId, live: u128) {
        let now = U64(env::block_timestamp_ms());
        match self.pool_refs.iter_mut().find(|r| &r.token_in == token_in && &r.token_out == token_out) {
            Some(r) => {
                r.out_per_in_e6 = U128((r.out_per_in_e6.0 * 3 + live) / 4);
                r.at_ms = now;
            }
            None => self.pool_refs.push(PoolRef { token_in: token_in.clone(), token_out: token_out.clone(), out_per_in_e6: U128(live), at_ms: now }),
        }
    }

    /// (lane that takes refusal strikes, lane that pays, guard key to verify with).
    fn caller_lane(&self) -> (Option<usize>, usize, Vec<u8>) {
        let pred = env::predecessor_account_id();
        if pred == self.owner {
            return (None, LANE_AGENT, self.guard_key.clone());
        }
        require!(
            pred == env::current_account_id(),
            "Only the vault's agent key or the owner can execute trades"
        );
        let pk = env::signer_account_pk();
        if self.agent_key.as_ref() == Some(&pk) {
            return (Some(LANE_AGENT), LANE_AGENT, self.guard_key.clone());
        }
        if self.challenge_key.as_ref() == Some(&pk) {
            let g = self.challenge_guard_key.clone().unwrap_or_else(|| env::panic_str("No challenge guard key"));
            return (Some(LANE_CHALLENGE), LANE_CHALLENGE, g);
        }
        env::panic_str("Signer is not the registered agent key")
    }

    fn reject_in(&mut self, strike_lane: Option<usize>, id: u64, check: &str, detail: &str, q: Option<&Quote>) -> Outcome {
        if let Some(l) = strike_lane {
            let s = (self.effective_strikes(l) + 1).min(MAX_STRIKES);
            self.lanes[l].strikes = s;
            self.lanes[l].strike_at_ms = env::block_timestamp_ms();
        }
        self.reject(id, check, detail, q)
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn assert_owner_or_guardian(&self) {
        let p = env::predecessor_account_id();
        require!(p == self.owner || p == self.guardian, "Only the owner or the guardian can do this");
    }

    fn assert_policy(p: &Policy) {
        require!(p.max_trade_usd_cents.0 <= p.daily_cap_usd_cents.0, "Per-trade cap can't exceed the daily cap");
        require!(p.max_cost_bps <= 1_000, "max_cost_bps above 10% is not allowed");
        require!(p.max_slippage_bps <= 1_000, "max_slippage_bps above 10% is not allowed");
        for (t, _) in &p.max_amount_per_trade {
            require!(p.allowed_tokens.contains(t), "Every capped token must be allowlisted");
        }
    }

    /// True when `new` allows nothing that `old` didn't.
    fn assert_exit_shape(&self, venue: &AccountId, token_in: &AccountId, token_out: &AccountId, min_amount_out: U128) {
        require!(self.policy.exit_tokens.contains(token_out), "token_out is not an exit token");
        require!(self.policy.allowed_tokens.contains(token_in), "token_in is not allowlisted");
        require!(self.policy.allowed_venues.contains(venue), "venue is not allowed");
        require!(token_in.as_str() != NEAR_TOKEN, "Wrap NEAR first");
        require!(min_amount_out.0 > 0, "Set a minimum output");
    }

    fn run_exit(&mut self, id: U64, detail: &str) {
        let idx = self.pending_exits.iter().position(|e| e.id == id).unwrap_or_else(|| env::panic_str("No queued exit with that id"));
        let e = self.pending_exits.remove(idx);
        self.log_event(id.0, Status::Executed, "EXIT_DEEP", detail, None);
        self.dispatch(id.0, &TradeKind::RefSwap { pool_id: e.pool_id }, &e.token_in, &e.token_out, e.amount, e.min_amount_out, &e.venue, 0, LANE_AGENT);
    }

    fn record_rate(&mut self, token_in: &AccountId, token_out: &AccountId, amount_in: U128, min_out: U128) {
        if amount_in.0 == 0 {
            return;
        }
        let Some(rate) = min_out.0.checked_mul(1_000_000).map(|x| x / amount_in.0) else { return };
        let r = LastRate { token_in: token_in.clone(), token_out: token_out.clone(), out_per_in_e6: U128(rate), at_ms: U64(env::block_timestamp_ms()) };
        match self.last_rates.iter_mut().find(|l| &l.token_in == token_in && &l.token_out == token_out) {
            Some(l) => *l = r,
            None => self.last_rates.push(r),
        }
    }

    fn reference_rate(&self, token_in: &AccountId, token_out: &AccountId) -> Option<u128> {
        self.last_rates
            .iter()
            .find(|l| &l.token_in == token_in && &l.token_out == token_out)
            .map(|l| l.out_per_in_e6.0)
            .or_else(|| {
                self.policy
                    .price_floors
                    .iter()
                    .find(|f| &f.token_in == token_in && &f.token_out == token_out)
                    .map(|f| f.min_out_per_in_e6.0)
            })
    }

    fn is_no_looser(new: &Policy, old: &Policy) -> bool {
        (new.kill_switch || !old.kill_switch)
            && new.allowed_tokens.iter().all(|t| old.allowed_tokens.contains(t))
            && new.allowed_venues.iter().all(|v| old.allowed_venues.contains(v))
            && new.max_amount_per_trade.iter().all(|(t, c)| {
                old.max_amount_per_trade.iter().any(|(ot, oc)| ot == t && c.0 <= oc.0)
            })
            && new.max_trade_usd_cents.0 <= old.max_trade_usd_cents.0
            && new.daily_cap_usd_cents.0 <= old.daily_cap_usd_cents.0
            && new.approval_above_usd_cents.0 <= old.approval_above_usd_cents.0
            && new.max_cost_bps <= old.max_cost_bps
            && new.exit_tokens.iter().all(|t| old.exit_tokens.contains(t))
            && new.exit_max_discount_bps <= old.exit_max_discount_bps
            && new.max_slippage_bps <= old.max_slippage_bps
            && new.shock_bps <= old.shock_bps
            && new.leak_budget_usd_cents.0 <= old.leak_budget_usd_cents.0
            && new.challenge_daily_cap_usd_cents.0 <= old.challenge_daily_cap_usd_cents.0
            && old.usd_tokens.iter().all(|t| new.usd_tokens.contains(t))
            && old.price_floors.iter().all(|of| {
                new.price_floors.iter().any(|nf| {
                    nf.token_in == of.token_in
                        && nf.token_out == of.token_out
                        && nf.min_out_per_in_e6.0 >= of.min_out_per_in_e6.0
                })
            })
    }

    fn check_limits(&self, q: &Quote, lane: usize) -> Result<(), (&'static str, String)> {
        let p = &self.policy;
        if !p.allowed_tokens.contains(&q.token_in) || !p.allowed_tokens.contains(&q.token_out) {
            let bad = if p.allowed_tokens.contains(&q.token_in) { &q.token_out } else { &q.token_in };
            return Err(("ALLOWLIST", format!("{} is not on the vault's token allowlist.", bad)));
        }
        if q.token_in == q.token_out {
            return Err(("PAIR", "From and to tokens are the same.".into()));
        }
        if !p.allowed_venues.contains(&q.venue) {
            return Err(("VENUE", format!("{} is not an allowed venue.", q.venue)));
        }
        let shape_ok = match q.kind {
            TradeKind::Wrap => q.token_in.as_str() == NEAR_TOKEN && q.token_out == q.venue,
            TradeKind::Unwrap => q.token_in == q.venue && q.token_out.as_str() == NEAR_TOKEN,
            TradeKind::RefSwap { .. } => q.token_in.as_str() != NEAR_TOKEN && q.token_out.as_str() != NEAR_TOKEN,
        };
        if !shape_ok {
            return Err(("TRADE_SHAPE", "Trade kind doesn't match its tokens and venue.".into()));
        }
        match q.kind {
            TradeKind::Wrap | TradeKind::Unwrap => {
                if q.min_amount_out != q.amount_in {
                    return Err(("MIN_OUTPUT", "Wrapping is 1:1, so the minimum output must equal the input.".into()));
                }
            }
            TradeKind::RefSwap { .. } => {
                if q.min_amount_out.0 == 0 {
                    return Err(("MIN_OUTPUT", "A swap must set a minimum output.".into()));
                }
                let floor = p
                    .price_floors
                    .iter()
                    .find(|f| f.token_in == q.token_in && f.token_out == q.token_out);
                let Some(floor) = floor else {
                    return Err(("PRICE_FLOOR", "The owner hasn't set a price floor for this pair, so it can't be swapped.".into()));
                };
                let lhs = q.min_amount_out.0.checked_mul(1_000_000);
                let rhs = q.amount_in.0.checked_mul(floor.min_out_per_in_e6.0);
                match (lhs, rhs) {
                    (Some(l), Some(r)) if l >= r => {}
                    _ => {
                        return Err((
                            "PRICE_FLOOR",
                            "The quote's minimum output is below the owner's price floor for this pair.".into(),
                        ))
                    }
                }
            }
        }
        let raw_cap = p
            .max_amount_per_trade
            .iter()
            .find(|(t, _)| t == &q.token_in)
            .map(|(_, c)| c.0);
        match raw_cap {
            None => return Err(("SIZE", format!("{} has no per-trade cap, so it can't be traded.", q.token_in))),
            Some(c) if q.amount_in.0 > c => {
                return Err(("SIZE", format!("Amount is over the vault's raw cap for {}.", q.token_in)))
            }
            _ => {}
        }
        if q.amount_in.0 == 0 {
            return Err(("SIZE", "Amount is zero.".into()));
        }
        if q.usd_cents.0 > p.max_trade_usd_cents.0 {
            return Err((
                "SIZE",
                format!("${} is over the ${} per-trade cap.", cents(q.usd_cents.0), cents(p.max_trade_usd_cents.0)),
            ));
        }
        if q.cost_bps > p.max_cost_bps {
            return Err((
                "COST",
                format!("Fees and price impact are {} bps; the limit is {} bps.", q.cost_bps, p.max_cost_bps),
            ));
        }
        let spent = self.lanes[lane].spent_today_cents;
        let cap = self.lane_cap(lane);
        if spent + q.usd_cents.0 > cap {
            return Err((
                "DAILY_CAP",
                format!(
                    "${} spent today plus ${} would pass the ${} daily cap.",
                    cents(spent),
                    cents(q.usd_cents.0),
                    cents(cap)
                ),
            ));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn dispatch(
        &self,
        id: u64,
        kind: &TradeKind,
        token_in: &AccountId,
        token_out: &AccountId,
        amount: U128,
        min_out: U128,
        venue: &AccountId,
        usd: u64,
        lane: usize,
    ) {
        let call = match kind {
            TradeKind::Wrap => Promise::new(venue.clone()).function_call(
                "near_deposit".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(amount.0),
                GAS_FOR_CALL,
            ),
            TradeKind::Unwrap => Promise::new(venue.clone()).function_call(
                "near_withdraw".to_string(),
                near_sdk::serde_json::json!({ "amount": amount }).to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FOR_CALL,
            ),
            TradeKind::RefSwap { pool_id } => {
                // The contract writes the instruction; nothing here comes from the quote as free text.
                let msg = near_sdk::serde_json::json!({
                    "force": 0,
                    "actions": [{
                        "pool_id": pool_id,
                        "token_in": token_in,
                        "token_out": token_out,
                        "amount_in": amount,
                        "min_amount_out": min_out,
                    }]
                })
                .to_string();
                Promise::new(token_in.clone()).function_call(
                    "ft_transfer_call".to_string(),
                    near_sdk::serde_json::json!({ "receiver_id": venue, "amount": amount, "msg": msg })
                        .to_string()
                        .into_bytes(),
                    ONE_YOCTO,
                    GAS_FOR_SWAP,
                )
            }
        };
        let _ = call.then(
            Promise::new(env::current_account_id()).function_call(
                "on_dispatched".to_string(),
                near_sdk::serde_json::json!({ "id": U64(id), "usd_cents": U64(usd), "lane": lane as u8 }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_CALLBACK,
            ),
        );
    }

    fn reject(&mut self, id: u64, check: &str, detail: &str, q: Option<&Quote>) -> Outcome {
        self.stats.rejected += 1;
        self.log_event(id, Status::Rejected, check, detail, q);
        env::log_str(&format!("REJECTED {}: {}", check, detail));
        Outcome { id: U64(id), status: Status::Rejected, check: check.into(), detail: detail.into() }
    }

    fn log_event(&mut self, id: u64, status: Status, check: &str, detail: &str, q: Option<&Quote>) {
        if self.events.len() >= MAX_EVENTS {
            self.events.remove(0);
        }
        self.events.push(Event {
            id: U64(id),
            at_ms: U64(env::block_timestamp_ms()),
            status,
            check: check.into(),
            detail: detail.into(),
            token_in: q.map(|q| q.token_in.clone()),
            amount_in: q.map(|q| q.amount_in),
            usd_cents: q.map(|q| q.usd_cents),
        });
    }

    fn roll_day(&mut self) {
        let today = env::block_timestamp_ms() / DAY_MS;
        for l in self.lanes.iter_mut() {
            if l.day != today {
                l.day = today;
                l.spent_today_cents = 0;
                l.leak_today_cents = 0;
            }
        }
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

fn cents(c: u64) -> String {
    if c % 100 == 0 {
        format!("{}", c / 100)
    } else {
        format!("{}.{:02}", c / 100, c % 100)
    }
}

#[cfg(test)]
mod tests;
