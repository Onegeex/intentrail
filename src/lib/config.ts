import type { GuardrailPolicy, NetworkId } from "./types";
import { ALLOWLISTED_SYMBOLS } from "./tokens";
import { TRADE_ONLY_FC_KEY, fcKeyScope as getFcKeyScope } from "./fc-key";

export { TRADE_ONLY_FC_KEY, getFcKeyScope };

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw === "yes";
}

export function resolveNetwork(): NetworkId {
  const requested = (process.env.NEAR_NETWORK || "testnet").toLowerCase();
  const allowMainnet = parseBool(process.env.ALLOW_MAINNET, false);
  if (requested === "mainnet" && allowMainnet) return "mainnet";
  return "testnet";
}

export function isMainnetEnabled(): boolean {
  return resolveNetwork() === "mainnet";
}

export function isExecutionEnabled(): boolean {
  return isMainnetEnabled();
}

export function isDryQuoteApiEnabled(): boolean {
  return parseBool(process.env.ALLOW_DRY_QUOTES, true);
}

/** Optional NEAR AI Cloud — off by default; needs NEAR_AI_API_KEY. */
export function isNearAiEnabled(): boolean {
  return (
    parseBool(process.env.NEAR_AI_ENABLED, false) &&
    Boolean(process.env.NEAR_AI_API_KEY && process.env.NEAR_AI_API_KEY.length > 8)
  );
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

export const HARD_CAPS = {
  maxLossPerTradeUsd: 10,
  dailySpendCapUsd: 100,
  maxSlippageBps: 200,
  maxTradeUsd: 50,
  minTradeUsd: 1,
  /** Hard cap for real mainnet execution (server + client). */
  maxMainnetSwapUsd: 1,
  maxFeeBps: 50,
  /** Agent Economy: premium signal micro-payment */
  signalFeeUsd: 0.05,
  maxSignalFeePerCallUsd: 0.1,
  dailySignalSpendCapUsd: 2,
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

export const ALLOWED_CONTRACT_METHODS: ReadonlyArray<{
  contract: string;
  methods: readonly string[];
}> = [
  {
    contract: TRADE_ONLY_FC_KEY.mainnetContract,
    methods: TRADE_ONLY_FC_KEY.methodsMainnet,
  },
  {
    contract: TRADE_ONLY_FC_KEY.testnetContract,
    methods: TRADE_ONLY_FC_KEY.methodsTestnet,
  },
];
