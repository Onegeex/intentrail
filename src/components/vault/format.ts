export const EXPLORER = "https://testnet.nearblocks.io";
export const REPO = "https://github.com/Onegeex/intentrail";
export const CONTRACT_SRC = `${REPO}/blob/main/contract/src/lib.rs`;
export const CONTRACT_TESTS = `${REPO}/blob/main/contract/src/tests.rs`;

export function yoctoToNear(y: string | null | undefined, digits = 3): string {
  if (!y) return "0";
  try {
    const big = BigInt(y);
    const whole = big / BigInt("1000000000000000000000000");
    const frac = (big % BigInt("1000000000000000000000000")).toString().padStart(24, "0").slice(0, digits);
    return `${whole.toString()}.${frac}`.replace(/\.?0+$/, "") || "0";
  } catch {
    return "0";
  }
}

export function centsToUsd(c: string | number | null | undefined): string {
  const n = Number(c ?? 0) / 100;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export function shortKey(k: string) {
  return k.length > 20 ? `${k.slice(0, 14)}…${k.slice(-6)}` : k;
}

export function timeAgo(ms: number | string): string {
  const d = Date.now() - Number(ms);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}

/** Plain names for the contract's check codes. */
export const CHECK_LABEL: Record<string, string> = {
  OK: "Passed every check",
  KILL_SWITCH: "Kill switch",
  GUARD_SIGNATURE: "Guard signature",
  QUOTE_FORMAT: "Quote format",
  QUOTE_VAULT: "Quote is for this vault",
  QUOTE_EXPIRED: "Quote is fresh",
  QUOTE_REPLAY: "Quote used once",
  ALLOWLIST: "Token allowlist",
  PAIR: "Different tokens",
  VENUE: "Approved venue",
  TRADE_SHAPE: "Output returns to vault",
  SIZE: "Per-trade cap",
  COST: "Fees and price impact",
  DAILY_CAP: "Daily cap",
  OWNER_APPROVAL: "Owner approval",
};

export const STATUS_LABEL: Record<string, string> = {
  Executed: "Executed",
  Rejected: "Refused",
  PendingApproval: "Waiting for owner",
  Approved: "Approved by owner",
  Failed: "Venue failed, refunded",
  Cancelled: "Cancelled",
};
