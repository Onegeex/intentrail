import { fetchPrices } from "./prices";
import {
  VAULT_ID,
  WRAP_ID,
  agentAttempt,
  agentExecute,
  getVaultSnapshot,
  newNonce,
  signQuote,
  type TxResult,
  type VaultQuote,
} from "./vault";

const YOCTO = BigInt("1000000000000000000000000");

function nearToYocto(n: number): bigint {
  return (BigInt(Math.round(n * 1e6)) * YOCTO) / BigInt(1e6);
}

/** Live NEAR price, or throw: the guard never signs on fallback prices. */
export async function liveNearPrice(): Promise<number> {
  const { prices, degraded } = await fetchPrices(["NEAR"], { bypassCache: true });
  const p = prices[0];
  if (degraded || p.source !== "coingecko") throw new Error("No live NEAR price; the guard won't sign.");
  return p.priceUsd;
}

/** The guard prices and signs a NEAR <-> wNEAR trade through wrap.testnet. */
export function buildWrapQuote(opts: {
  direction: "wrap" | "unwrap";
  near: number;
  priceUsd: number;
  usdOverrideCents?: number;
  venue?: string;
  kindOverride?: VaultQuote["kind"];
}): VaultQuote {
  const amount = nearToYocto(opts.near).toString();
  const cents = opts.usdOverrideCents ?? Math.round(opts.near * opts.priceUsd * 100);
  const wrap = opts.direction === "wrap";
  return {
    vault: VAULT_ID,
    kind: opts.kindOverride ?? (wrap ? "Wrap" : "Unwrap"),
    token_in: wrap ? "near" : WRAP_ID,
    token_out: wrap ? WRAP_ID : "near",
    amount_in: amount,
    min_amount_out: amount,
    venue: opts.venue ?? WRAP_ID,
    msg: "",
    usd_cents: String(cents),
    // wrap.testnet converts 1:1, so fees and price impact are zero.
    cost_bps: 0,
    nonce: newNonce(),
    expires_at_ms: String(Date.now() + 120_000),
  };
}

export type AgentRun = {
  intent: string;
  priceUsd: number;
  quote: VaultQuote;
  tx: TxResult;
};

/** The agent's autonomous trade: small, so no human is needed. */
export async function runAgentTrade(size: "small" | "large"): Promise<AgentRun> {
  const priceUsd = await liveNearPrice();
  const snap = await getVaultSnapshot();
  const targetUsd = size === "small" ? 1.5 : 6;
  const near = Number((targetUsd / priceUsd).toFixed(4));
  const wnear = Number(BigInt(snap.balances.wnearYocto) / BigInt(1e18)) / 1e6;
  const direction: "wrap" | "unwrap" = wnear >= near + 0.01 && Math.random() < 0.5 ? "unwrap" : "wrap";
  const quote = buildWrapQuote({ direction, near, priceUsd });
  const { quoteJson, signatureB64 } = signQuote(quote);
  const tx = await agentExecute(quoteJson, signatureB64);
  return {
    intent: `${direction === "wrap" ? "NEAR to wNEAR" : "wNEAR to NEAR"}, ${near} NEAR ($${(near * priceUsd).toFixed(2)})`,
    priceUsd,
    quote,
    tx,
  };
}

export type Attempt = {
  id: string;
  title: string;
  how: string;
  expected: "protocol" | "contract" | "executes";
  result: TxResult;
  blocked: boolean;
  blockedBy: string;
};

const ATTACKER = "attacker-intentrail.testnet";

function verdict(r: TxResult, expected: Attempt["expected"]): { blocked: boolean; by: string } {
  if (r.outcome) {
    const s = r.outcome.status;
    if (s === "Rejected") return { blocked: true, by: `Contract check ${r.outcome.check}: ${r.outcome.detail}` };
    if (s === "PendingApproval") return { blocked: true, by: `Held for the owner: ${r.outcome.detail}` };
    return { blocked: false, by: r.outcome.detail };
  }
  if (r.protocolError) {
    if (expected === "protocol") return { blocked: true, by: r.protocolError };
    if (/Only the owner|agent key/i.test(r.protocolError)) return { blocked: true, by: "Contract refused: only the owner can do this." };
    return { blocked: true, by: r.protocolError };
  }
  return { blocked: false, by: "Unexpected: no outcome" };
}

/** Real attempts to drain the vault with the agent's own key, on testnet. */
export async function runAttackSuite(): Promise<{ priceUsd: number; attempts: Attempt[] }> {
  const priceUsd = await liveNearPrice();
  const attempts: Attempt[] = [];
  const add = (a: Omit<Attempt, "blocked" | "blockedBy">) => {
    const v = verdict(a.result, a.expected);
    attempts.push({ ...a, blocked: v.blocked, blockedBy: v.by });
  };

  add({
    id: "withdraw",
    title: "Call withdraw() to pull funds out",
    how: "Agent key calls the vault's owner-only withdraw method.",
    expected: "protocol",
    result: await agentAttempt("withdraw", ATTACKER),
  });
  add({
    id: "token",
    title: "Transfer wNEAR straight from the token contract",
    how: "Agent key signs ft_transfer on wrap.testnet to an attacker account.",
    expected: "protocol",
    result: await agentAttempt("direct_ft_transfer", ATTACKER),
  });
  add({
    id: "native",
    title: "Send NEAR to an attacker",
    how: "Agent key signs a plain NEAR transfer out of the vault.",
    expected: "protocol",
    result: await agentAttempt("native_transfer", ATTACKER),
  });

  // Tamper: guard signs $1.50, agent edits the signed quote to move 2.5 NEAR.
  const honest = buildWrapQuote({ direction: "wrap", near: Number((1.5 / priceUsd).toFixed(4)), priceUsd });
  const signed = signQuote(honest);
  const tampered = signed.quoteJson.replace(`"amount_in":"${honest.amount_in}"`, `"amount_in":"${nearToYocto(2.5).toString()}"`);
  add({
    id: "tamper",
    title: "Edit a signed quote to move more",
    how: "Guard signed a $1.50 trade; the agent raises the amount before sending it.",
    expected: "contract",
    result: await agentExecute(tampered, signed.signatureB64),
  });

  // Compromised guard: even a properly signed $50 trade is refused by the contract.
  const big = buildWrapQuote({ direction: "wrap", near: 2.9, priceUsd, usdOverrideCents: 5_000 });
  const bigSigned = signQuote(big);
  add({
    id: "guard-compromised",
    title: "Use a stolen guard key to sign a $50 trade",
    how: "A validly signed quote far above the vault's $10 per-trade cap.",
    expected: "contract",
    result: await agentExecute(bigSigned.quoteJson, bigSigned.signatureB64),
  });
  add({
    id: "replay",
    title: "Replay the same signed quote",
    how: "Send the exact quote and signature a second time.",
    expected: "contract",
    result: await agentExecute(bigSigned.quoteJson, bigSigned.signatureB64),
  });

  const evil = buildWrapQuote({
    direction: "unwrap",
    near: 0.1,
    priceUsd,
    venue: ATTACKER,
    kindOverride: "FtTransferCall",
  });
  const evilSigned = signQuote(evil);
  add({
    id: "venue",
    title: "Route a trade to the attacker's contract",
    how: "A signed quote whose venue is an account the owner never approved.",
    expected: "contract",
    result: await agentExecute(evilSigned.quoteJson, evilSigned.signatureB64),
  });

  const ok = buildWrapQuote({ direction: "wrap", near: Number((1.2 / priceUsd).toFixed(4)), priceUsd });
  const okSigned = signQuote(ok);
  add({
    id: "honest",
    title: "An honest $1.20 trade, for comparison",
    how: "Within every limit. The agent doesn't need anyone's permission.",
    expected: "executes",
    result: await agentExecute(okSigned.quoteJson, okSigned.signatureB64),
  });

  return { priceUsd, attempts };
}
