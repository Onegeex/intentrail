#!/usr/bin/env node
// IntentRail public challenge: you hold the vault's agent key AND a guard key.
// Sign any swap you like and send it. The contract decides.
//
//   npm i near-api-js@7
//   node scripts/challenge.mjs --wnear 0.3 --give-away 3      # minimum 3% under the live pool
//   node scripts/challenge.mjs --wnear 200                    # far over the size cap
//   node scripts/challenge.mjs --wnear 0.3 --claim-usd 0.01   # lie about the trade's value
//   node scripts/challenge.mjs --method withdraw              # any other method: NEAR refuses
//
// Keys are published on purpose, in src/data/challenge.json. They are limited to
// their own lane on the vault: own daily cap, own leak budget, own strikes.
import { createPrivateKey, sign } from "crypto";
import { readFileSync } from "fs";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";

const C = JSON.parse(readFileSync(new URL("../src/data/challenge.json", import.meta.url)));
const RPC = "https://rpc.testnet.near.org";
const REF = "ref-finance-101.testnet", POOL = 1084, WRAP = "wrap.testnet", USDT = "usdt.itachicara.testnet";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const raw = (x) => (BigInt(Math.round(Number(x) * 1e6)) * 10n ** 18n).toString();

const provider = new JsonRpcProvider({ url: RPC });
const acct = new Account(C.vault, provider, KeyPairSigner.fromSecretKey(C.challenge_agent_private_key));

async function view(contract, method, args) {
  const r = await provider.query({
    request_type: "call_function", finality: "final", account_id: contract, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

const method = arg("method", "execute");
if (method !== "execute") {
  try {
    await acct.callFunction({ contractId: C.vault, methodName: method, args: {}, gas: 30n * 10n ** 12n });
    console.log("Unexpected: NEAR accepted the call.");
  } catch (e) {
    console.log("Refused by NEAR before it reached the contract:", String(e.message || e).slice(0, 200));
  }
  process.exit(0);
}

const amountIn = raw(arg("wnear", "0.3"));
const live = await view(REF, "get_return", { pool_id: POOL, token_in: WRAP, amount_in: amountIn, token_out: USDT });
const giveAway = Number(arg("give-away", "0.5"));
const minOut = ((BigInt(live) * BigInt(Math.round((100 - giveAway) * 100))) / 10000n).toString();
const claimUsd = Number(arg("claim-usd", String(Number(BigInt(live) / 10n ** 18n) / 1e6)));

const quote = {
  vault: C.vault, kind: { RefSwap: { pool_id: POOL } }, token_in: WRAP, token_out: USDT,
  amount_in: amountIn, min_amount_out: minOut, venue: REF, usd_cents: String(Math.round(claimUsd * 100)),
  cost_bps: 30, nonce: `${Date.now()}000`, expires_at_ms: String(Date.now() + 120_000),
};
const quoteJson = JSON.stringify(quote);
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(C.challenge_guard_seed_b64, "base64")]),
  format: "der", type: "pkcs8",
});
const signature = sign(null, Buffer.from(quoteJson), key).toString("base64");

console.log(`Signed: sell ${arg("wnear", "0.3")} wNEAR, minimum ${giveAway}% under the live pool, claimed $${claimUsd}`);
const r = await acct.signAndSendTransaction({
  receiverId: C.vault,
  actions: [actions.functionCall("execute", { quote_json: quoteJson, signature }, 300n * 10n ** 12n, 0n)],
  throwOnFailure: false, waitUntil: "EXECUTED_OPTIMISTIC",
});
const ok = r.status?.SuccessValue;
console.log(ok ? JSON.parse(Buffer.from(ok, "base64").toString()) : r.status);
console.log(`https://testnet.nearblocks.io/txns/${r.transaction.hash}`);
