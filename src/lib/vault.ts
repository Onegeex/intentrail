import { createPrivateKey, randomInt, sign as edSign } from "crypto";
import {
  Account,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPairSigner,
  actions,
  type KeyPairString,
} from "near-api-js";

/**
 * Server-side client for the GuardVault contract on NEAR testnet.
 *
 * Two keys live on the server, in Vercel environment variables:
 *  - GUARD_SIGNING_KEY: signs quotes the guard has priced and checked.
 *  - AGENT_PRIVATE_KEY: the agent's function-call key on the vault. NEAR only
 *    lets it call `execute` on the vault; it can't transfer, add keys, or
 *    call any other contract.
 * Neither key can move funds on its own. The contract decides.
 */

export const VAULT_ID = process.env.VAULT_ID || "intentrail-vault2-39ae84.testnet";
export const VAULT_OWNER_ID = process.env.VAULT_OWNER_ID || "intentrail-owner-39ae84.testnet";
export const WRAP_ID = "wrap.testnet";
export const REF_ID = "ref-finance-101.testnet";
export const USDT_ID = "usdt.itachicara.testnet";
export const REF_POOL_ID = 1084;
export const ATTACKER_ID = process.env.ATTACKER_ID || "intentrail-attacker-39ae84.testnet";
export const EXPLORER = "https://testnet.nearblocks.io";

const RPC_URLS = (process.env.NEAR_TESTNET_RPC || "https://rpc.testnet.near.org,https://test.rpc.fastnear.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let provider: FailoverRpcProvider | null = null;
export function rpc() {
  if (!provider) {
    provider = new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url })));
  }
  return provider;
}

export function isVaultConfigured() {
  return Boolean(process.env.GUARD_SIGNING_KEY && process.env.AGENT_PRIVATE_KEY);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type VaultPolicy = {
  kill_switch: boolean;
  allowed_tokens: string[];
  allowed_venues: string[];
  max_amount_per_trade: [string, string][];
  max_trade_usd_cents: string;
  daily_cap_usd_cents: string;
  approval_above_usd_cents: string;
  max_cost_bps: number;
  price_floors?: { token_in: string; token_out: string; min_out_per_in_e6: string }[];
};

export type VaultEvent = {
  id: string;
  at_ms: string;
  status: "Executed" | "Rejected" | "PendingApproval" | "Approved" | "Failed" | "Cancelled";
  check: string;
  detail: string;
  token_in?: string | null;
  amount_in?: string | null;
  usd_cents?: string | null;
};

export type VaultSnapshot = {
  vaultId: string;
  ownerId: string;
  policy: VaultPolicy;
  stats: { executed: number; rejected: number; pending: number; failed: number };
  spentTodayCents: number;
  events: VaultEvent[];
  pending: Array<{ id: string; usd_cents: string; token_in: string; token_out: string; amount_in: string; created_ms: string }>;
  keys: Array<{ publicKey: string; fullAccess: boolean; methods: string[]; receiver: string | null; allowanceYocto: string | null }>;
  balances: { nearYocto: string; wnearYocto: string; usdtRaw: string };
  pendingPolicy: { eta_ms: string; policy: VaultPolicy } | null;
  timelockMs: number;
  asOf: string;
};

async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = VAULT_ID): Promise<T> {
  const r = await rpc().callFunction({ contractId, method, args });
  return r as T;
}

export async function getVaultSnapshot(): Promise<VaultSnapshot> {
  const p = rpc();
  const [policy, stats, spent, events, pending, keyList, account, wnear, usdt, pendingPolicy, timelock] = await Promise.all([
    view<VaultPolicy>("get_policy"),
    view<VaultSnapshot["stats"]>("get_stats"),
    view<string>("get_spent_today"),
    view<VaultEvent[]>("get_events"),
    view<VaultSnapshot["pending"]>("get_pending"),
    p.viewAccessKeyList({ accountId: VAULT_ID, finalityQuery: { finality: "optimistic" } } as never).catch(() => null),
    p.viewAccount({ accountId: VAULT_ID, finalityQuery: { finality: "optimistic" } } as never).catch(() => null),
    view<string>("ft_balance_of", { account_id: VAULT_ID }, WRAP_ID).catch(() => "0"),
    view<string>("ft_balance_of", { account_id: VAULT_ID }, USDT_ID).catch(() => "0"),
    view<VaultSnapshot["pendingPolicy"]>("get_pending_policy").catch(() => null),
    view<string>("get_timelock_ms").catch(() => "0"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys = ((keyList as any)?.keys ?? []).map((k: any) => {
    const perm = k.access_key?.permission ?? k.accessKey?.permission;
    const fc = perm?.FunctionCall ?? perm?.functionCall;
    return {
      publicKey: String(k.public_key ?? k.publicKey),
      fullAccess: perm === "FullAccess" || perm?.fullAccess !== undefined,
      methods: fc?.method_names ?? fc?.methodNames ?? [],
      receiver: fc?.receiver_id ?? fc?.receiverId ?? null,
      allowanceYocto: fc?.allowance != null ? String(fc.allowance) : null,
    };
  });

  return {
    vaultId: VAULT_ID,
    ownerId: VAULT_OWNER_ID,
    policy,
    stats,
    spentTodayCents: Number(spent ?? 0),
    events: events ?? [],
    pending: pending ?? [],
    keys,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    balances: { nearYocto: String((account as any)?.amount ?? "0"), wnearYocto: String(wnear ?? "0"), usdtRaw: String(usdt ?? "0") },
    pendingPolicy: pendingPolicy ?? null,
    timelockMs: Number(timelock ?? 0),
    asOf: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Guard signing
// ---------------------------------------------------------------------------

export type TradeKind = "Wrap" | "Unwrap" | { RefSwap: { pool_id: number } };

export type VaultQuote = {
  vault: string;
  kind: TradeKind;
  token_in: string;
  token_out: string;
  amount_in: string;
  min_amount_out: string;
  venue: string;
  usd_cents: string;
  cost_bps: number;
  nonce: string;
  expires_at_ms: string;
};

function guardKey(which: "current" | "leaked" = "current") {
  const seedB64 = which === "leaked" ? process.env.GUARD_LEAKED_KEY || process.env.GUARD_SIGNING_KEY : process.env.GUARD_SIGNING_KEY;
  if (!seedB64) throw new Error("GUARD_SIGNING_KEY not configured");
  const seed = Buffer.from(seedB64, "base64");
  if (seed.length !== 32) throw new Error("GUARD_SIGNING_KEY must be a 32-byte seed");
  // PKCS#8 wrapper for a raw ed25519 seed.
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Sign the exact JSON string the contract will verify. */
export function signQuote(q: VaultQuote, which: "current" | "leaked" = "current"): { quoteJson: string; signatureB64: string } {
  const quoteJson = JSON.stringify(q);
  const sig = edSign(null, Buffer.from(quoteJson, "utf8"), guardKey(which));
  return { quoteJson, signatureB64: sig.toString("base64") };
}

export function newNonce(): string {
  return `${Date.now()}${String(randomInt(0, 1000)).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Agent transactions
// ---------------------------------------------------------------------------

function outsiderAccount() {
  const sk = process.env.ATTACKER_PRIVATE_KEY;
  if (!sk) throw new Error("ATTACKER_PRIVATE_KEY not configured");
  return new Account(ATTACKER_ID, new JsonRpcProvider({ url: RPC_URLS[0] }) as never, KeyPairSigner.fromSecretKey(sk as KeyPairString));
}

function agentAccount() {
  const sk = process.env.AGENT_PRIVATE_KEY;
  if (!sk) throw new Error("AGENT_PRIVATE_KEY not configured");
  const signer = KeyPairSigner.fromSecretKey(sk as KeyPairString);
  // The agent signs as the vault account, using its function-call key.
  // A single provider here, so NEAR's own rejection reason reaches the caller.
  return new Account(VAULT_ID, new JsonRpcProvider({ url: RPC_URLS[0] }) as never, signer);
}

export type TxResult = {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  /** Contract's Outcome for execute(), when it returned one. */
  outcome?: { id: string; status: string; check: string; detail: string };
  /** Protocol-level refusal (the tx never ran). */
  protocolError?: string;
  logs?: string[];
};

function parseResponse(r: unknown): TxResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = r as any;
  const hash: string | undefined = res?.transaction?.hash ?? res?.transaction_outcome?.id;
  const status = res?.status ?? {};
  let outcome: TxResult["outcome"];
  if (typeof status.SuccessValue === "string" && status.SuccessValue.length) {
    try {
      outcome = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));
    } catch {
      outcome = undefined;
    }
  }
  const logs: string[] = (res?.receipts_outcome ?? []).flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ro: any) => ro?.outcome?.logs ?? [],
  );
  let failure = status.Failure ? JSON.stringify(status.Failure) : undefined;
  const panic = failure?.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) failure = `Refused by the contract: ${panic[1]}`;
  return {
    ok: !failure,
    txHash: hash,
    explorerUrl: hash ? `${EXPLORER}/txns/${hash}` : undefined,
    outcome,
    protocolError: failure,
    logs,
  };
}

function describeError(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any;
  const raw = [err?.message, err?.cause?.message].filter(Boolean).join(" ").replace(/\s*""\s*$/, "").trim();
  const said = raw ? ` NEAR said: "${raw.slice(0, 200)}"` : "";
  if (/does not allow method|MethodName/i.test(raw)) return `Refused by NEAR: the agent's key may only call execute().${said}`;
  if (/receiver|Receiver/i.test(raw)) return `Refused by NEAR: the agent's key only works on the vault contract.${said}`;
  if (/full access|FullAccess|Transfer|transfer/i.test(raw)) return `Refused by NEAR: sending tokens needs a full-access key, and the vault has none.${said}`;
  if (/allowance/i.test(raw)) return `Refused by NEAR: the agent's key has no budget for that.${said}`;
  return `Refused by NEAR.${said}`;
}

/** Agent calls execute() with a guard-signed quote. `as: "outsider"` sends it from an unrelated account. */
export async function agentExecute(quoteJson: string, signatureB64: string, as: "agent" | "outsider" = "agent"): Promise<TxResult> {
  try {
    const acct = as === "agent" ? agentAccount() : outsiderAccount();
    const r = await acct.signAndSendTransaction({
      receiverId: VAULT_ID,
      actions: [
        actions.functionCall(
          "execute",
          { quote_json: quoteJson, signature: signatureB64 },
          BigInt("150000000000000"),
          BigInt(0),
        ),
      ],
      throwOnFailure: false,
      waitUntil: "EXECUTED_OPTIMISTIC",
    } as never);
    return parseResponse(r);
  } catch (e) {
    return { ok: false, protocolError: describeError(e) };
  }
}

/** Whatever transaction an (LLM) agent asks for, signed with the agent key. NEAR and the contract decide. */
export async function agentRawCall(opts: {
  receiverId: string;
  method?: string;
  args?: Record<string, unknown>;
  depositYocto?: string;
  transferYocto?: string;
}): Promise<TxResult> {
  const acct = agentAccount();
  try {
    const action = opts.transferYocto
      ? actions.transfer(BigInt(opts.transferYocto))
      : actions.functionCall(opts.method || "execute", opts.args || {}, BigInt("100000000000000"), BigInt(opts.depositYocto || "0"));
    const r = await acct.signAndSendTransaction({ receiverId: opts.receiverId, actions: [action], throwOnFailure: false } as never);
    return parseResponse(r);
  } catch (e) {
    return { ok: false, protocolError: describeError(e) };
  }
}

/** Agent key attempts something it isn't allowed to. Used by the bypass demo. */
export async function agentAttempt(
  kind: "withdraw" | "direct_ft_transfer" | "native_transfer" | "change_policy",
  attacker: string,
): Promise<TxResult> {
  const acct = agentAccount();
  try {
    let r: unknown;
    if (kind === "withdraw") {
      r = await acct.signAndSendTransaction({
        receiverId: VAULT_ID,
        actions: [actions.functionCall("withdraw", { token: "near", amount: "1000000000000000000000000" }, BigInt("30000000000000"), BigInt(0))],
        throwOnFailure: false,
      } as never);
    } else if (kind === "change_policy") {
      r = await acct.signAndSendTransaction({
        receiverId: VAULT_ID,
        actions: [actions.functionCall("set_kill_switch", { on: false }, BigInt("30000000000000"), BigInt(0))],
        throwOnFailure: false,
      } as never);
    } else if (kind === "direct_ft_transfer") {
      r = await acct.signAndSendTransaction({
        receiverId: WRAP_ID,
        actions: [
          actions.functionCall("ft_transfer", { receiver_id: attacker, amount: "1000000000000000000000000" }, BigInt("30000000000000"), BigInt(0)),
        ],
        throwOnFailure: false,
      } as never);
    } else {
      r = await acct.signAndSendTransaction({
        receiverId: attacker,
        // A small amount, so the refusal is about permission, not the key's fee allowance.
        actions: [actions.transfer(BigInt("1000000000000000000"))],
        throwOnFailure: false,
      } as never);
    }
    return parseResponse(r);
  } catch (e) {
    return { ok: false, protocolError: describeError(e) };
  }
}
