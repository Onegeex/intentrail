import { ONECLICK_BASE, isMainnetEnabled, resolveNetwork } from "./config";
import { getTokenBySymbol } from "./tokens";
import type { QuoteResult, TradeProposal } from "./types";

/**
 * NEAR Intents / 1Click integration.
 * HACKATHON.md Q-007: no Intents testnet. We only call the live quote API
 * with dry:true when mainnet is explicitly enabled; otherwise return a stub
 * so demos work on testnet without spending or leaking keys.
 *
 * JWT is optional (Q-006). Never logs Authorization headers.
 */
export async function requestDryQuote(proposal: TradeProposal): Promise<QuoteResult> {
  const from = getTokenBySymbol(proposal.fromSymbol);
  const to = getTokenBySymbol(proposal.toSymbol);
  if (!from || !to) {
    return { dry: true, ok: false, message: "Token not allowlisted" };
  }

  // Fail closed: never hit mainnet Intents unless explicitly enabled
  if (!isMainnetEnabled()) {
    return {
      dry: true,
      ok: true,
      stub: true,
      message: `Stub dry-quote on ${resolveNetwork()} (Intents has no testnet; set NEAR_NETWORK=mainnet and ALLOW_MAINNET=true for live dry quotes)`,
      amountIn: proposal.amountIn,
      amountOut: proposal.estimatedOut,
      amountInUsd: String(proposal.amountUsd),
      amountOutUsd: String(
        Math.max(0, proposal.amountUsd - proposal.estimatedFeeUsd).toFixed(4),
      ),
      timeEstimateSec: 120,
    };
  }

  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  // Placeholder refund/recipient — dry quotes should not create deposit addresses.
  // Using a well-known burn-like format is wrong; use a dummy NEAR implicit-looking
  // placeholder only for dry simulation. Real execution requires the user's wallet address.
  const placeholder = "intentrail-dry.near";

  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: proposal.slippageBps,
    originAsset: from.intentsAssetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: to.intentsAssetId,
    amount: proposal.amountIn,
    refundTo: placeholder,
    refundType: "ORIGIN_CHAIN",
    recipient: placeholder,
    recipientType: "DESTINATION_CHAIN",
    deadline,
    referral: "intentrail",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Optional partner JWT from env — never expose to client
  const jwt = process.env.ONECLICK_JWT;
  if (jwt && jwt.length > 0 && jwt.length < 4096) {
    headers.Authorization = `Bearer ${jwt}`;
  }

  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // Avoid hanging the API route
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        dry: true,
        ok: false,
        message: `1Click quote failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      correlationId?: string;
      quote?: {
        amountIn?: string;
        amountOut?: string;
        amountInUsd?: string;
        amountOutUsd?: string;
        timeEstimate?: number;
      };
    };

    return {
      dry: true,
      ok: true,
      stub: false,
      message: "Live dry quote from 1Click (no deposit address)",
      amountIn: data.quote?.amountIn,
      amountOut: data.quote?.amountOut,
      amountInUsd: data.quote?.amountInUsd,
      amountOutUsd: data.quote?.amountOutUsd,
      timeEstimateSec: data.quote?.timeEstimate,
      correlationId: data.correlationId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "quote error";
    return { dry: true, ok: false, message: msg };
  }
}
