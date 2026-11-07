import { fetchPrices } from "./prices";
import {
  REF_ID,
  REF_POOL_ID,
  USDT_ID,
  VAULT_ID,
  WRAP_ID,
  agentAttempt,
  agentExecute,
  getVaultSnapshot,
  newNonce,
  rpc,
  signQuote,
  type TxResult,
  type VaultQuote,
} from "./vault";

const E24 = BigInt("1000000000000000000000000");
/** The guard accepts this much slippage below the DEX's own quote. */
const SLIPPAGE_BPS = BigInt(50);

function toRaw(n: number): bigint {
  return (BigInt(Math.round(n * 1e6)) * E24) / BigInt(1e6);
}
export function rawToNum(r: bigint | string): number {
  return Number(BigInt(r) / BigInt(1e18)) / 1e6;
}

/** Live mainnet NEAR price, or throw: the guard never signs on fallback prices. */
export async function liveNearPrice(): Promise<number> {
  const { prices, degraded } = await fetchPrices(["NEAR"], { bypassCache: true });
  const p = prices[0];
  if (degraded || p.source !== "coingecko") throw new Error("No live NEAR price; the guard won't sign.");
  return p.priceUsd;
}

export type SwapDir = "to_usdt" | "to_wnear";

export type RefQuote = {
  dir: SwapDir;
  amountIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  spotOut: bigint;
  costBps: number;
  wnearPerUsdt: number;
};

/** Price a swap from the Ref pool itself: expected output, spot, and fee + impact. */
export async function quoteRef(dir: SwapDir, amountIn: bigint): Promise<RefQuote> {
  const [tin, tout] = dir === "to_usdt" ? [WRAP_ID, USDT_ID] : [USDT_ID, WRAP_ID];
  const [ret, pool] = await Promise.all([
    rpc().callFunction({
      contractId: REF_ID,
      method: "get_return",
      args: { pool_id: REF_POOL_ID, token_in: tin, amount_in: amountIn.toString(), token_out: tout },
    }),
    rpc().callFunction({ contractId: REF_ID, method: "get_pool", args: { pool_id: REF_POOL_ID } }),
  ]);
  const expectedOut = BigInt(String(ret));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = pool as any;
  const ids: string[] = p.token_account_ids;
  const amounts: bigint[] = p.amounts.map((a: string) => BigInt(a));
  const rIn = amounts[ids.indexOf(tin)];
  const rOut = amounts[ids.indexOf(tout)];
  const spotOut = (amountIn * rOut) / rIn;
  const costBps = spotOut > BigInt(0) ? Number(((spotOut - expectedOut) * BigInt(10_000)) / spotOut) : 10_000;
  const wnearIdx = ids.indexOf(WRAP_ID);
  const usdtIdx = ids.indexOf(USDT_ID);
  const wnearPerUsdt = Number((amounts[wnearIdx] * BigInt(1e6)) / amounts[usdtIdx]) / 1e6;
  return {
    dir,
    amountIn,
    expectedOut,
    minOut: (expectedOut * (BigInt(10_000) - SLIPPAGE_BPS)) / BigInt(10_000),
    spotOut,
    costBps,
    wnearPerUsdt,
  };
}

/** USD value of a swap input, from the mainnet NEAR price. */
function usdCents(q: RefQuote, nearUsd: number): number {
  const wnear = q.dir === "to_usdt" ? rawToNum(q.amountIn) : rawToNum(q.amountIn) * q.wnearPerUsdt;
  return Math.round(wnear * nearUsd * 100);
}

export function buildSwapQuote(q: RefQuote, nearUsd: number, over?: Partial<VaultQuote>): VaultQuote {
  return {
    vault: VAULT_ID,
    kind: { RefSwap: { pool_id: REF_POOL_ID } },
    token_in: q.dir === "to_usdt" ? WRAP_ID : USDT_ID,
    token_out: q.dir === "to_usdt" ? USDT_ID : WRAP_ID,
    amount_in: q.amountIn.toString(),
    min_amount_out: q.minOut.toString(),
    venue: REF_ID,
    usd_cents: String(usdCents(q, nearUsd)),
    cost_bps: q.costBps,
    nonce: newNonce(),
    expires_at_ms: String(Date.now() + 120_000),
    ...over,
  };
}

export function buildWrapQuote(near: number, nearUsd: number, over?: Partial<VaultQuote>): VaultQuote {
  const amount = toRaw(near).toString();
  return {
    vault: VAULT_ID,
    kind: "Wrap",
    token_in: "near",
    token_out: WRAP_ID,
    amount_in: amount,
    min_amount_out: amount,
    venue: WRAP_ID,
    usd_cents: String(Math.round(near * nearUsd * 100)),
    cost_bps: 0,
    nonce: newNonce(),
    expires_at_ms: String(Date.now() + 120_000),
    ...over,
  };
}

export type AgentRun = { intent: string; priceUsd: number; quote: VaultQuote; tx: TxResult; pricing?: string };

/** Choose and send a trade of roughly `usd` dollars. */
export async function tradeUsd(usd: number, prefer?: "wrap" | SwapDir): Promise<AgentRun> {
  const nearUsd = await liveNearPrice();
  const snap = await getVaultSnapshot();
  const wnear = rawToNum(snap.balances.wnearYocto);
  const usdt = rawToNum(snap.balances.usdtRaw);
  const nearAmt = Number((usd / nearUsd).toFixed(4));

  let choice: "wrap" | SwapDir = prefer ?? "wrap";
  if (!prefer) {
    if (wnear >= nearAmt * 1.05 && (usdt < 1 || Math.random() < 0.6)) choice = "to_usdt";
    else if (usdt >= 1) choice = "to_wnear";
    else choice = "wrap";
  }

  if (choice === "wrap") {
    const quote = buildWrapQuote(nearAmt, nearUsd);
    const s = signQuote(quote);
    return {
      intent: `Wrap ${nearAmt} NEAR into wNEAR ($${(nearAmt * nearUsd).toFixed(2)})`,
      priceUsd: nearUsd,
      quote,
      tx: await agentExecute(s.quoteJson, s.signatureB64),
      pricing: "wrap.testnet converts 1:1, so the minimum output equals the input.",
    };
  }

  const pool = await quoteRef(choice, BigInt(1)); // for the rate
  const amountIn =
    choice === "to_usdt" ? toRaw(nearAmt) : toRaw(Number((nearAmt / pool.wnearPerUsdt).toFixed(4)));
  const rq = await quoteRef(choice, amountIn);
  const quote = buildSwapQuote(rq, nearUsd);
  const s = signQuote(quote);
  const [inSym, outSym] = choice === "to_usdt" ? ["wNEAR", "USDT"] : ["USDT", "wNEAR"];
  return {
    intent: `Swap ${rawToNum(amountIn).toFixed(4)} ${inSym} for ${outSym} on Ref Finance ($${(Number(quote.usd_cents) / 100).toFixed(2)})`,
    priceUsd: nearUsd,
    quote,
    tx: await agentExecute(s.quoteJson, s.signatureB64),
    pricing: `Ref quoted ${rawToNum(rq.expectedOut).toFixed(4)} ${outSym} (fee and price impact ${rq.costBps} bps). The vault will accept no less than ${rawToNum(rq.minOut).toFixed(4)}.`,
  };
}

export async function runAgentTrade(size: "small" | "large"): Promise<AgentRun> {
  return tradeUsd(size === "small" ? 1.5 : 6);
}

// ---------------------------------------------------------------------------
// The attack suite
// ---------------------------------------------------------------------------

export type Layer = "near" | "contract" | "dex" | "none";

export type Attempt = {
  id: string;
  layer: Layer;
  title: string;
  how: string;
  result: TxResult;
  blocked: boolean;
  blockedBy: string;
};

const ATTACKER = "intentrail-attacker-39ae84.testnet";

function verdict(r: TxResult): { blocked: boolean; by: string } {
  if (r.outcome) {
    const s = r.outcome.status;
    if (s === "Rejected") return { blocked: true, by: `Contract check ${r.outcome.check}: ${r.outcome.detail}` };
    if (s === "PendingApproval") return { blocked: true, by: `Held for the owner: ${r.outcome.detail}` };
    return { blocked: false, by: r.outcome.detail };
  }
  if (r.protocolError) return { blocked: true, by: r.protocolError };
  return { blocked: false, by: "No outcome returned." };
}

async function venueOutcome(txHash: string | undefined): Promise<string | null> {
  if (!txHash) return null;
  // Give the callback a moment, then read the vault's own log for that trade.
  await new Promise((r) => setTimeout(r, 2500));
  const snap = await getVaultSnapshot();
  const failed = snap.events.find((e) => e.status === "Failed");
  return failed ? failed.detail : null;
}

export async function runAttackSuite(): Promise<{ priceUsd: number; attempts: Attempt[] }> {
  const nearUsd = await liveNearPrice();
  const attempts: Attempt[] = [];
  const add = (a: Omit<Attempt, "blocked" | "blockedBy">, override?: { blocked: boolean; by: string }) => {
    const v = override ?? verdict(a.result);
    attempts.push({ ...a, blocked: v.blocked, blockedBy: v.by });
  };

  // Layer 1: NEAR's access keys.
  add({ id: "withdraw", layer: "near", title: "Call withdraw() to pull funds out", how: "The agent key calls the vault's owner-only withdraw method.", result: await agentAttempt("withdraw", ATTACKER) });
  add({ id: "token", layer: "near", title: "Transfer wNEAR straight from the token contract", how: "The agent key signs ft_transfer on wrap.testnet to the attacker.", result: await agentAttempt("direct_ft_transfer", ATTACKER) });
  add({ id: "native", layer: "near", title: "Send NEAR to the attacker", how: "The agent key signs a plain NEAR transfer out of the vault.", result: await agentAttempt("native_transfer", ATTACKER) });

  // Layer 2: the contract.
  const small = buildWrapQuote(Number((1.2 / nearUsd).toFixed(4)), nearUsd);
  const smallSigned = signQuote(small);
  add({
    id: "outsider",
    layer: "contract",
    title: "Call execute() from another account with a valid quote",
    how: "An outside account submits a genuine guard-signed quote. Only the agent key or the owner may execute.",
    result: await agentExecute(smallSigned.quoteJson, smallSigned.signatureB64, "outsider"),
  });

  const honest = buildWrapQuote(Number((1.5 / nearUsd).toFixed(4)), nearUsd);
  const hs = signQuote(honest);
  const tampered = hs.quoteJson.replace(`"amount_in":"${honest.amount_in}"`, `"amount_in":"${toRaw(2.5).toString()}"`);
  add({ id: "tamper", layer: "contract", title: "Edit a signed quote to move more", how: "The guard signed a $1.50 trade; the agent raises the amount before sending it.", result: await agentExecute(tampered, hs.signatureB64) });

  const big = buildWrapQuote(2.9, nearUsd, { usd_cents: "5000" });
  const bigSigned = signQuote(big);
  add({ id: "leaked-size", layer: "contract", title: "Steal the guard key and sign a $50 trade", how: "A leak nobody has noticed yet: a validly signed quote, far above the $10 per-trade cap.", result: await agentExecute(bigSigned.quoteJson, bigSigned.signatureB64) });

  const rq = await quoteRef("to_usdt", toRaw(0.3));
  const dump = buildSwapQuote(rq, nearUsd, { min_amount_out: (rq.expectedOut / BigInt(2)).toString() });
  const dumpSigned = signQuote(dump);
  add({ id: "leaked-price", layer: "contract", title: "Steal the guard key and sell at half price", how: "A validly signed swap whose minimum output is half the market rate.", result: await agentExecute(dumpSigned.quoteJson, dumpSigned.signatureB64) });

  if (process.env.GUARD_LEAKED_KEY) {
    const old = buildWrapQuote(Number((1.2 / nearUsd).toFixed(4)), nearUsd);
    const oldSigned = signQuote(old, "leaked");
    add({ id: "rotated", layer: "contract", title: "Use the guard key the owner already rotated out", how: "After the key-leak drill, quotes signed by the old key are worthless.", result: await agentExecute(oldSigned.quoteJson, oldSigned.signatureB64) });
  }

  add({ id: "replay", layer: "contract", title: "Replay the same signed quote", how: "Send that exact quote and signature a second time.", result: await agentExecute(bigSigned.quoteJson, bigSigned.signatureB64) });

  const evil = buildSwapQuote(rq, nearUsd, { venue: ATTACKER });
  const evilSigned = signQuote(evil);
  add({ id: "venue", layer: "contract", title: "Send a swap to the attacker's contract", how: "A signed swap whose venue is an account the owner never approved.", result: await agentExecute(evilSigned.quoteJson, evilSigned.signatureB64) });

  // Layer 3: the DEX enforces the minimum output the contract wrote.
  const greedy = buildSwapQuote(rq, nearUsd, { min_amount_out: ((rq.spotOut * BigInt(102)) / BigInt(100)).toString() });
  const greedySigned = signQuote(greedy);
  const g = await agentExecute(greedySigned.quoteJson, greedySigned.signatureB64);
  const gDetail = g.outcome?.status === "Executed" ? await venueOutcome(g.txHash) : null;
  add(
    { id: "underfill", layer: "dex", title: "Ask the pool for more than it can give", how: "A swap whose minimum output is 2% above the pool price. The contract passes it on; Ref must refuse it.", result: g },
    gDetail ? { blocked: true, by: `Refused by Ref Finance: ${gDetail}` } : undefined,
  );

  // An honest swap, for comparison.
  const okq = buildSwapQuote(await quoteRef("to_usdt", toRaw(0.3)), nearUsd);
  const oks = signQuote(okq);
  add({ id: "honest", layer: "none", title: "An honest swap, for comparison", how: `Sell 0.3 wNEAR for USDT on Ref Finance, within every limit. The agent needs nobody's permission.`, result: await agentExecute(oks.quoteJson, oks.signatureB64) });

  return { priceUsd: nearUsd, attempts };
}
