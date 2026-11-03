import {
  ONECLICK_BASE,
  isDryQuoteApiEnabled,
  isExecutionEnabled,
  resolveNetwork,
} from "./config";
import { getTokenBySymbol } from "./tokens";
import type { QuoteResult, TradeProposal } from "./types";

function simulatedQuote(proposal: TradeProposal, reason: string): QuoteResult {
  const feeUsd = proposal.estimatedFeeUsd;
  const feeBps = Math.round((feeUsd / Math.max(proposal.amountUsd, 1e-9)) * 10_000);
  return {
    dry: true,
    ok: true,
    simulated: true,
    stub: true,
    message: `Simulated quote — ${reason}`,
    amountIn: proposal.amountIn,
    amountInFormatted: String(proposal.amountUsd),
    amountOut: proposal.estimatedOut,
    amountOutFormatted: proposal.estimatedOut,
    amountInUsd: String(proposal.amountUsd),
    amountOutUsd: String(Math.max(0, proposal.amountUsd - feeUsd).toFixed(4)),
    minAmountOut: proposal.estimatedOut,
    timeEstimateSec: 120,
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    feeUsd,
    feeBps,
    slippageBps: proposal.slippageBps,
    executionEnabled: isExecutionEnabled(),
  };
}

/**
 * NEAR Intents / 1Click dry quote (read-only).
 * HACKATHON.md Q-007: no Intents testnet — dry quotes use the public mainnet
 * 1Click API with dry:true (no depositAddress). Execution stays disabled unless
 * NEAR_NETWORK=mainnet AND ALLOW_MAINNET=true.
 * JWT optional (Q-006). Never logs Authorization headers or paths.
 */
export async function requestDryQuote(proposal: TradeProposal): Promise<QuoteResult> {
  const from = getTokenBySymbol(proposal.fromSymbol);
  const to = getTokenBySymbol(proposal.toSymbol);
  if (!from || !to) {
    return {
      dry: true,
      ok: false,
      simulated: true,
      message: "Token not allowlisted",
      executionEnabled: isExecutionEnabled(),
    };
  }

  if (!isDryQuoteApiEnabled()) {
    return simulatedQuote(
      proposal,
      `ALLOW_DRY_QUOTES disabled (app network=${resolveNetwork()})`,
    );
  }

  // Amount must be integer base units. Rebuild from USD using token decimals when needed.
  let amount = proposal.amountIn;
  if (!/^\d+$/.test(amount) || amount === "0") {
    const units = proposal.amountUsd / 1; // USD ≈ USDC; for others agent sets amountIn
    const scaled = Math.floor(units * 10 ** Math.min(from.decimals, 8));
    amount = String(Math.max(1, scaled));
  }
  // Prefer correct USDC (6 dec) sizing when from is USDC
  if (from.symbol === "USDC") {
    amount = String(Math.max(1, Math.round(proposal.amountUsd * 1e6)));
  } else if (from.symbol === "NEAR") {
    // yocto with 24 decimals — use 8-decimal milli precision then pad
    const near = proposal.amountUsd / Math.max(1, 3.5); // rough; agent should set amountIn
    const whole = Math.max(1, Math.floor(near * 1e8));
    amount = proposal.amountIn && /^\d+$/.test(proposal.amountIn)
      ? proposal.amountIn
      : `${whole}${"0".repeat(16)}`;
  }

  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  // Dry quotes must not create deposit addresses. Placeholders are never used for spend.
  const placeholder = "intentrail.near";

  const body = {
    dry: true as const,
    swapType: "EXACT_INPUT" as const,
    slippageTolerance: proposal.slippageBps,
    originAsset: from.intentsAssetId,
    depositType: "INTENTS" as const,
    destinationAsset: to.intentsAssetId,
    amount,
    refundTo: placeholder,
    refundType: "INTENTS" as const,
    recipient: placeholder,
    recipientType: "INTENTS" as const,
    deadline,
    referral: "intentrail",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const jwt = process.env.ONECLICK_JWT;
  if (jwt && jwt.length > 0 && jwt.length < 4096) {
    headers.Authorization = `Bearer ${jwt}`;
  }

  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      // Do not leak upstream body/paths to clients
      console.error("[intentrail] 1Click quote status", res.status);
      return simulatedQuote(proposal, `1Click unavailable (${res.status}); using simulated`);
    }

    const data = (await res.json()) as {
      correlationId?: string;
      timestamp?: string;
      quoteRequest?: {
        deadline?: string;
        slippageTolerance?: number;
        appFees?: Array<{ fee?: number }>;
      };
      quote?: {
        amountIn?: string;
        amountInFormatted?: string;
        amountOut?: string;
        amountOutFormatted?: string;
        amountInUsd?: string;
        amountOutUsd?: string;
        minAmountOut?: string;
        timeEstimate?: number;
        deadline?: string;
      };
    };

    const q = data.quote;
    if (!q?.amountOut) {
      return simulatedQuote(proposal, "1Click returned empty quote; using simulated");
    }

    const inUsd = Number(q.amountInUsd ?? proposal.amountUsd);
    const outUsd = Number(q.amountOutUsd ?? 0);
    const feeUsd = Number.isFinite(inUsd) && Number.isFinite(outUsd)
      ? Math.max(0, inUsd - outUsd)
      : proposal.estimatedFeeUsd;
    const feeBps = inUsd > 0 ? Math.round((feeUsd / inUsd) * 10_000) : 0;
    const appFeeBps = data.quoteRequest?.appFees?.[0]?.fee;

    return {
      dry: true,
      ok: true,
      simulated: false,
      stub: false,
      message: "Live dry quote from NEAR Intents 1Click (no deposit; execution gated)",
      amountIn: q.amountIn,
      amountInFormatted: q.amountInFormatted,
      amountOut: q.amountOut,
      amountOutFormatted: q.amountOutFormatted,
      amountInUsd: q.amountInUsd,
      amountOutUsd: q.amountOutUsd,
      minAmountOut: q.minAmountOut,
      timeEstimateSec: q.timeEstimate,
      correlationId: data.correlationId,
      deadline: data.quoteRequest?.deadline || deadline,
      feeUsd: Number(feeUsd.toFixed(6)),
      feeBps,
      slippageBps: data.quoteRequest?.slippageTolerance ?? proposal.slippageBps,
      appFeeBps,
      executionEnabled: isExecutionEnabled(),
    };
  } catch (err) {
    console.error(
      "[intentrail] 1Click quote error:",
      err instanceof Error ? err.message : "error",
    );
    return simulatedQuote(proposal, "1Click request failed; using simulated");
  }
}
