import {
  HARD_CAPS,
  ONECLICK_BASE,
  isDryQuoteApiEnabled,
  isExecutionEnabled,
  resolveNetwork,
} from "./config";
import { getTokenBySymbol } from "./tokens";
import type { QuoteResult, TradeProposal } from "./types";

function oneClickHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const jwt = process.env.ONECLICK_JWT;
  if (jwt && jwt.length > 0 && jwt.length < 4096) {
    headers.Authorization = `Bearer ${jwt}`;
  }
  return headers;
}

function amountForProposal(proposal: TradeProposal): string {
  const from = getTokenBySymbol(proposal.fromSymbol);
  if (!from) return proposal.amountIn;
  if (from.symbol === "USDC") {
    return String(Math.max(1, Math.round(proposal.amountUsd * 1e6)));
  }
  if (proposal.amountIn && /^\d+$/.test(proposal.amountIn)) return proposal.amountIn;
  if (from.symbol === "NEAR") {
    // Caller should supply amountIn; rough pad if missing
    const near = proposal.amountUsd / 3.5;
    const whole = Math.max(1, Math.floor(near * 1e8));
    return `${whole}${"0".repeat(16)}`;
  }
  return proposal.amountIn;
}

function feeFromQuote(
  proposal: TradeProposal,
  q: { amountInUsd?: string; amountOutUsd?: string },
): { feeUsd: number; feeBps: number } {
  const inUsd = Number(q.amountInUsd ?? proposal.amountUsd);
  const outUsd = Number(q.amountOutUsd ?? 0);
  const feeUsd =
    Number.isFinite(inUsd) && Number.isFinite(outUsd)
      ? Math.max(0, inUsd - outUsd)
      : proposal.estimatedFeeUsd;
  const feeBps = inUsd > 0 ? Math.round((feeUsd / inUsd) * 10_000) : 0;
  return { feeUsd: Number(feeUsd.toFixed(6)), feeBps };
}

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

type OneClickQuoteResponse = {
  correlationId?: string;
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
    depositAddress?: string;
    depositMemo?: string;
  };
};

/**
 * NEAR Intents / 1Click dry quote (read-only). Never creates a deposit address.
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

  const amount = amountForProposal(proposal);
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
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

  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
      method: "POST",
      headers: oneClickHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.error("[intentrail] 1Click quote status", res.status);
      return simulatedQuote(proposal, `1Click unavailable (${res.status}); using simulated`);
    }
    const data = (await res.json()) as OneClickQuoteResponse;
    const q = data.quote;
    if (!q?.amountOut) {
      return simulatedQuote(proposal, "1Click returned empty quote; using simulated");
    }
    const { feeUsd, feeBps } = feeFromQuote(proposal, q);
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
      feeUsd,
      feeBps,
      slippageBps: data.quoteRequest?.slippageTolerance ?? proposal.slippageBps,
      appFeeBps: data.quoteRequest?.appFees?.[0]?.fee,
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

export type ExecutableQuoteInput = {
  proposal: TradeProposal;
  /** User NEAR account — refund + recipient (user keeps custody) */
  accountId: string;
};

/**
 * Non-dry 1Click quote → depositAddress. Fail-closed on caps + dual flags.
 * Server never signs; caller must have user sign the deposit in their wallet.
 */
export async function requestExecutableQuote(
  input: ExecutableQuoteInput,
): Promise<QuoteResult> {
  const { proposal, accountId } = input;

  if (!isExecutionEnabled()) {
    return {
      dry: false,
      ok: false,
      simulated: false,
      message:
        "Execution disabled. Set NEAR_NETWORK=mainnet and ALLOW_MAINNET=true locally (never on shared demo).",
      executionEnabled: false,
    };
  }

  if (proposal.amountUsd > HARD_CAPS.maxMainnetSwapUsd + 1e-9) {
    return {
      dry: false,
      ok: false,
      simulated: false,
      message: `Mainnet swap hard-capped at $${HARD_CAPS.maxMainnetSwapUsd} (got $${proposal.amountUsd})`,
      executionEnabled: true,
    };
  }

  if (!/^[a-z0-9._-]+$/.test(accountId) || accountId.length > 64) {
    return {
      dry: false,
      ok: false,
      simulated: false,
      message: "Invalid NEAR accountId",
      executionEnabled: true,
    };
  }

  const from = getTokenBySymbol(proposal.fromSymbol);
  const to = getTokenBySymbol(proposal.toSymbol);
  if (!from || !to || !from.nearContractId) {
    return {
      dry: false,
      ok: false,
      simulated: false,
      message: "Token pair not supported for ORIGIN_CHAIN deposit",
      executionEnabled: true,
    };
  }

  const amount = amountForProposal(proposal);
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();

  const body = {
    dry: false as const,
    swapType: "EXACT_INPUT" as const,
    slippageTolerance: proposal.slippageBps,
    originAsset: from.intentsAssetId,
    depositType: "ORIGIN_CHAIN" as const,
    destinationAsset: to.intentsAssetId,
    amount,
    refundTo: accountId,
    refundType: "ORIGIN_CHAIN" as const,
    recipient: accountId,
    recipientType: "INTENTS" as const,
    deadline,
    referral: "intentrail",
  };

  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
      method: "POST",
      headers: oneClickHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[intentrail] 1Click executable quote status", res.status);
      return {
        dry: false,
        ok: false,
        simulated: false,
        message: `1Click executable quote failed (${res.status})`,
        executionEnabled: true,
      };
    }
    const data = (await res.json()) as OneClickQuoteResponse;
    const q = data.quote;
    if (!q?.amountOut || !q.depositAddress) {
      return {
        dry: false,
        ok: false,
        simulated: false,
        message: "1Click did not return a deposit address",
        executionEnabled: true,
      };
    }
    const { feeUsd, feeBps } = feeFromQuote(proposal, q);
    return {
      dry: false,
      ok: true,
      simulated: false,
      stub: false,
      message:
        "Executable 1Click quote — sign deposit in your wallet (server never holds keys)",
      amountIn: q.amountIn ?? amount,
      amountInFormatted: q.amountInFormatted,
      amountOut: q.amountOut,
      amountOutFormatted: q.amountOutFormatted,
      amountInUsd: q.amountInUsd,
      amountOutUsd: q.amountOutUsd,
      minAmountOut: q.minAmountOut,
      timeEstimateSec: q.timeEstimate,
      correlationId: data.correlationId,
      deadline: q.deadline || data.quoteRequest?.deadline || deadline,
      feeUsd,
      feeBps,
      slippageBps: data.quoteRequest?.slippageTolerance ?? proposal.slippageBps,
      appFeeBps: data.quoteRequest?.appFees?.[0]?.fee,
      executionEnabled: true,
      depositAddress: q.depositAddress,
      depositMemo: q.depositMemo,
      depositContractId: from.nearContractId,
      depositMethod: "ft_transfer",
    };
  } catch (err) {
    console.error(
      "[intentrail] executable quote error:",
      err instanceof Error ? err.message : "error",
    );
    return {
      dry: false,
      ok: false,
      simulated: false,
      message: "1Click executable quote request failed",
      executionEnabled: true,
    };
  }
}

export async function getSwapStatus(depositAddress: string): Promise<{
  ok: boolean;
  status?: string;
  updatedAt?: string;
  message: string;
}> {
  if (!depositAddress || depositAddress.length > 128) {
    return { ok: false, message: "Invalid depositAddress" };
  }
  try {
    const url = new URL(`${ONECLICK_BASE}/v0/status`);
    url.searchParams.set("depositAddress", depositAddress);
    const res = await fetch(url.toString(), {
      headers: oneClickHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, message: `Status unavailable (${res.status})` };
    }
    const data = (await res.json()) as { status?: string; updatedAt?: string };
    return {
      ok: true,
      status: data.status,
      updatedAt: data.updatedAt,
      message: data.status || "unknown",
    };
  } catch {
    return { ok: false, message: "Status request failed" };
  }
}
