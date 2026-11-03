import type { GuardrailPolicy, NetworkId } from "./types";
import { ALLOWLISTED_SYMBOLS } from "./tokens";

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw === "yes";
}

/**
 * Network selection is fail-closed:
 * - Default = testnet
 * - Mainnet only when NEAR_NETWORK=mainnet AND ALLOW_MAINNET=true
 */
export function resolveNetwork(): NetworkId {
  const requested = (process.env.NEAR_NETWORK || "testnet").toLowerCase();
  const allowMainnet = parseBool(process.env.ALLOW_MAINNET, false);
  if (requested === "mainnet") {
    if (!allowMainnet) {
      return "testnet";
    }
    return "mainnet";
  }
  return "testnet";
}

export function isMainnetEnabled(): boolean {
  return resolveNetwork() === "mainnet";
}

export function getRpcUrl(network: NetworkId = resolveNetwork()): string {
  if (process.env.NEAR_RPC_URL) return process.env.NEAR_RPC_URL;
  return network === "mainnet"
    ? "https://rpc.mainnet.near.org"
    : "https://rpc.testnet.near.org";
}

export function getRateLimitRpm(): number {
  return Math.min(120, Math.max(5, parsePositiveNumber(process.env.RATE_LIMIT_RPM, 30)));
}

/** Hard caps — env can only tighten within these bounds, never exceed. */
export const HARD_CAPS = {
  maxLossPerTradeUsd: 10,
  dailySpendCapUsd: 100,
  maxSlippageBps: 200,
  maxTradeUsd: 50,
  minTradeUsd: 1,
} as const;

export function getDefaultPolicy(): Omit<GuardrailPolicy, "killSwitch"> {
  const maxLoss = Math.min(
    HARD_CAPS.maxLossPerTradeUsd,
    parsePositiveNumber(process.env.MAX_LOSS_PER_TRADE_USD, 2),
  );
  const daily = Math.min(
    HARD_CAPS.dailySpendCapUsd,
    parsePositiveNumber(process.env.DAILY_SPEND_CAP_USD, 25),
  );
  const slip = Math.min(
    HARD_CAPS.maxSlippageBps,
    parsePositiveNumber(process.env.MAX_SLIPPAGE_BPS, 100),
  );
  return {
    maxLossPerTradeUsd: maxLoss,
    dailySpendCapUsd: daily,
    maxSlippageBps: slip,
    requireHumanApproval: parseBool(process.env.REQUIRE_HUMAN_APPROVAL, true),
    allowlistedSymbols: [...ALLOWLISTED_SYMBOLS],
  };
}

export const ONECLICK_BASE = "https://1click.chaindefuser.com";

/** Contracts the agent is allowed to call. Empty on purpose for Day 1 —
 * execution goes through wallet-signed 1Click deposits only, never arbitrary calls. */
export const ALLOWED_CONTRACT_METHODS: ReadonlyArray<{
  contract: string;
  methods: readonly string[];
}> = [
  // Intentionally empty: no arbitrary contract calls from the agent.
  // Future: add intents.near verifier methods only after review.
];
