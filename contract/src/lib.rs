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

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
    PublicKey,
};

const NEAR_TOKEN: &str = "near";
const DAY_MS: u64 = 86_400_000;
const MAX_EVENTS: usize = 25;
const GAS_FOR_CALL: Gas = Gas::from_tgas(60);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Gas allowance attached to the agent key. Fees only; it can't move funds.
const AGENT_KEY_ALLOWANCE: NearToken = NearToken::from_millinear(500);

/// What a trade does. Each shape returns its output to the vault.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum TradeKind {
    /// NEAR -> wNEAR: `near_deposit` on the wrap contract (venue).
    Wrap,
    /// wNEAR -> NEAR: `near_withdraw` on the wrap contract (venue = token_in).
    Unwrap,
    /// `ft_transfer_call(venue, amount, msg)` on token_in. Used for
    /// NEAR Intents (`intents.near`) deposits and DEX swaps, which credit
    /// the sender, i.e. the vault.
    FtTransferCall,
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
    #[serde(default)]
    pub msg: String,
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
    pub venue: AccountId,
    pub msg: String,
    pub usd_cents: U64,
    pub created_ms: U64,
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
    /// ed25519 public key (32 bytes) of the IntentRail guard server.
    guard_key: Vec<u8>,
    agent_key: Option<PublicKey>,
    policy: Policy,
    day: u64,
    spent_today_cents: u64,
    used_nonces: LookupSet<u64>,
    pending: IterableMap<u64, PendingTrade>,
    next_id: u64,
    stats: Stats,
    events: Vec<Event>,
}

#[near]
impl GuardVault {
    #[init]
    pub fn new(owner: AccountId, guard_key: Base64VecU8, policy: Policy) -> Self {
        require!(guard_key.0.len() == 32, "guard_key must be a 32-byte ed25519 public key");
        Self::assert_policy(&policy);
        Self {
            owner,
            guard_key: guard_key.0,
            agent_key: None,
            policy,
            day: env::block_timestamp_ms() / DAY_MS,
            spent_today_cents: 0,
            used_nonces: LookupSet::new(b"n"),
            pending: IterableMap::new(b"p"),
            next_id: 1,
            stats: Stats::default(),
            events: Vec::new(),
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
    pub fn execute(&mut self, quote_json: String, signature: Base64VecU8) -> Outcome {
        self.assert_agent_or_owner();
        self.roll_day();
        let id = self.take_id();

        if self.policy.kill_switch {
            return self.reject(id, "KILL_SWITCH", "The owner has stopped all trading.", None);
        }

        // 1. The guard must have signed exactly this quote.
        let sig: [u8; 64] = match signature.0.as_slice().try_into() {
            Ok(s) => s,
            Err(_) => return self.reject(id, "GUARD_SIGNATURE", "Signature is not 64 bytes.", None),
        };
        let pk: [u8; 32] = self.guard_key.as_slice().try_into().unwrap();
        if !env::ed25519_verify(&sig, quote_json.as_bytes(), &pk) {
            return self.reject(
                id,
                "GUARD_SIGNATURE",
                "Quote is not signed by the IntentRail guard key.",
                None,
            );
        }
        let q: Quote = match near_sdk::serde_json::from_str(&quote_json) {
            Ok(q) => q,
            Err(_) => return self.reject(id, "QUOTE_FORMAT", "Signed quote is not valid JSON.", None),
        };

        // 2. Bound to this vault, fresh, and single-use.
        if q.vault != env::current_account_id() {
            return self.reject(id, "QUOTE_VAULT", "Quote was signed for a different vault.", Some(&q));
        }
        if env::block_timestamp_ms() > q.expires_at_ms.0 {
            return self.reject(id, "QUOTE_EXPIRED", "Quote has expired.", Some(&q));
        }
        if self.used_nonces.contains(&q.nonce.0) {
            return self.reject(id, "QUOTE_REPLAY", "Quote was already used.", Some(&q));
        }

        // 3. Hard limits the guard can't override.
        if let Err((check, detail)) = self.check_limits(&q) {
            self.used_nonces.insert(q.nonce.0);
            return self.reject(id, check, &detail, Some(&q));
        }
        self.used_nonces.insert(q.nonce.0);

        // 4. Above the threshold a person decides.
        if q.usd_cents.0 > self.policy.approval_above_usd_cents.0 {
            let p = PendingTrade {
                id: U64(id),
                kind: q.kind.clone(),
                token_in: q.token_in.clone(),
                token_out: q.token_out.clone(),
                amount_in: q.amount_in,
                venue: q.venue.clone(),
                msg: q.msg.clone(),
                usd_cents: q.usd_cents,
                created_ms: U64(env::block_timestamp_ms()),
            };
            self.pending.insert(id, p);
            self.stats.pending += 1;
            let detail = format!(
                "${} is above the ${} autonomy limit. Waiting for the owner.",
                cents(q.usd_cents.0),
                cents(self.policy.approval_above_usd_cents.0)
            );
            self.log_event(id, Status::PendingApproval, "OWNER_APPROVAL", &detail, Some(&q));
            return Outcome { id: U64(id), status: Status::PendingApproval, check: "OWNER_APPROVAL".into(), detail };
        }

        self.spent_today_cents += q.usd_cents.0;
        self.dispatch(id, &q.kind, &q.token_in, q.amount_in, &q.venue, &q.msg, q.usd_cents.0);
        let detail = format!("Passed every check. ${} sent to {}.", cents(q.usd_cents.0), q.venue);
        self.log_event(id, Status::Executed, "OK", &detail, Some(&q));
        self.stats.executed += 1;
        Outcome { id: U64(id), status: Status::Executed, check: "OK".into(), detail }
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
        if self.spent_today_cents + p.usd_cents.0 > self.policy.daily_cap_usd_cents.0 {
            self.log_event(id.0, Status::Cancelled, "DAILY_CAP", "Would exceed today's cap.", None);
            return Outcome { id, status: Status::Cancelled, check: "DAILY_CAP".into(), detail: "Would exceed today's cap.".into() };
        }
        self.spent_today_cents += p.usd_cents.0;
        self.dispatch(id.0, &p.kind, &p.token_in, p.amount_in, &p.venue, &p.msg, p.usd_cents.0);
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

    pub fn set_kill_switch(&mut self, on: bool) {
        self.assert_owner();
        self.policy.kill_switch = on;
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        Self::assert_policy(&policy);
        self.policy = policy;
    }

    pub fn set_guard_key(&mut self, guard_key: Base64VecU8) {
        self.assert_owner();
        require!(guard_key.0.len() == 32, "guard_key must be 32 bytes");
        self.guard_key = guard_key.0;
    }

    /// Install (or rotate) the agent's key: a function-call key on this
    /// account that can call only `execute`, with a fee allowance and no
    /// ability to transfer tokens.
    pub fn set_agent_key(&mut self, public_key: PublicKey) -> Promise {
        self.assert_owner();
        let me = env::current_account_id();
        let mut p = Promise::new(me.clone());
        if let Some(old) = self.agent_key.take() {
            p = p.delete_key(old);
        }
        self.agent_key = Some(public_key.clone());
        p.add_access_key_allowance(
            public_key,
            near_sdk::Allowance::limited(AGENT_KEY_ALLOWANCE).unwrap(),
            me,
            "execute".to_string(),
        )
    }

    /// Owner can always take funds out, but only to the owner account.
    pub fn withdraw(&mut self, token: AccountId, amount: U128) -> Promise {
        self.assert_owner();
        if token.as_str() == NEAR_TOKEN {
            Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
        } else {
            Promise::new(token).function_call(
                "ft_transfer".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": self.owner, "amount": amount })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FOR_CALL,
            )
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
    pub fn on_dispatched(&mut self, id: U64, usd_cents: U64) {
        if let PromiseResult::Failed = env::promise_result(0) {
            self.spent_today_cents = self.spent_today_cents.saturating_sub(usd_cents.0);
            self.stats.failed += 1;
            self.stats.executed = self.stats.executed.saturating_sub(1);
            self.log_event(id.0, Status::Failed, "VENUE", "The venue call failed; nothing was spent.", None);
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
        if env::block_timestamp_ms() / DAY_MS != self.day {
            U64(0)
        } else {
            U64(self.spent_today_cents)
        }
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

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn assert_agent_or_owner(&self) {
        let pred = env::predecessor_account_id();
        if pred == self.owner {
            return;
        }
        require!(
            pred == env::current_account_id(),
            "Only the vault's agent key or the owner can execute trades"
        );
        let pk = env::signer_account_pk();
        require!(
            self.agent_key.as_ref() == Some(&pk),
            "Signer is not the registered agent key"
        );
    }

    fn assert_policy(p: &Policy) {
        require!(p.max_trade_usd_cents.0 <= p.daily_cap_usd_cents.0, "Per-trade cap can't exceed the daily cap");
        require!(p.max_cost_bps <= 1_000, "max_cost_bps above 10% is not allowed");
        for (t, _) in &p.max_amount_per_trade {
            require!(p.allowed_tokens.contains(t), "Every capped token must be allowlisted");
        }
    }

    fn check_limits(&self, q: &Quote) -> Result<(), (&'static str, String)> {
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
            TradeKind::FtTransferCall => q.token_in.as_str() != NEAR_TOKEN,
        };
        if !shape_ok {
            return Err(("TRADE_SHAPE", "Trade kind doesn't match its tokens and venue.".into()));
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
        if self.spent_today_cents + q.usd_cents.0 > p.daily_cap_usd_cents.0 {
            return Err((
                "DAILY_CAP",
                format!(
                    "${} spent today plus ${} would pass the ${} daily cap.",
                    cents(self.spent_today_cents),
                    cents(q.usd_cents.0),
                    cents(p.daily_cap_usd_cents.0)
                ),
            ));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn dispatch(&self, id: u64, kind: &TradeKind, token_in: &AccountId, amount: U128, venue: &AccountId, msg: &str, usd: u64) {
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
            TradeKind::FtTransferCall => Promise::new(token_in.clone()).function_call(
                "ft_transfer_call".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": venue, "amount": amount, "msg": msg })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FOR_CALL,
            ),
        };
        let _ = call.then(
            Promise::new(env::current_account_id()).function_call(
                "on_dispatched".to_string(),
                near_sdk::serde_json::json!({ "id": U64(id), "usd_cents": U64(usd) }).to_string().into_bytes(),
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
        if today != self.day {
            self.day = today;
            self.spent_today_cents = 0;
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
