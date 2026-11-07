/**
 * Plug your own agent into a GuardVault in a few lines.
 *
 * Your agent never holds funds. It holds a function-call key on the vault
 * that can only call execute(), and it sends quotes signed by your guard.
 * Run:  VAULT_ID=... AGENT_PRIVATE_KEY=ed25519:... GUARD_URL=https://your-guard npx tsx examples/agent-trade.ts
 */
import { Account, JsonRpcProvider, KeyPairSigner, actions, type KeyPairString } from "near-api-js";

const vault = process.env.VAULT_ID!;
const agent = new Account(
  vault, // the agent signs *as the vault*, with its execute-only key
  new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }),
  KeyPairSigner.fromSecretKey(process.env.AGENT_PRIVATE_KEY as KeyPairString),
);

async function trade(kind: "to_usdt" | "to_wnear" | "wrap", usd: number) {
  // 1. Ask your guard to price and sign the trade (it computes the minimum output itself).
  const { quoteJson, signatureB64 } = await fetch(`${process.env.GUARD_URL}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault, kind, usd }),
  }).then((r) => r.json());

  // 2. Send it. The vault contract runs every check and either trades or refuses.
  const res = await agent.signAndSendTransaction({
    receiverId: vault,
    actions: [actions.functionCall("execute", { quote_json: quoteJson, signature: signatureB64 }, BigInt(250e12), BigInt(0))],
  });
  console.log(res.transaction.hash, res.status);
}

trade("to_usdt", 1.5);
