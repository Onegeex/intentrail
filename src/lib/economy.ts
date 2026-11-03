import { HARD_CAPS } from "./config";
import { getSignalSpentToday, getState, recordSignalSpend } from "./store";
import type { SignalPayment } from "./types";

/**
 * Guardrailed agent spending — simulated micro-budget for a premium signal.
 * Same fail-closed ledger as trades (per-call + daily caps, kill switch).
 * Never moves chain funds or touches private keys. Always labeled simulated.
 */
export async function buyPremiumSignal(): Promise<SignalPayment> {
  const amountUsd = HARD_CAPS.signalFeeUsd;
  if (amountUsd > HARD_CAPS.maxSignalFeePerCallUsd + 1e-9) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: `Agent spend exceeds per-call cap $${HARD_CAPS.maxSignalFeePerCallUsd}`,
    };
  }

  const state = await getState();
  if (state.killSwitch || state.untrusted) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: "Kill switch / untrusted — agent spend blocked",
    };
  }

  const spent = await getSignalSpentToday();
  if (spent + amountUsd > HARD_CAPS.dailySignalSpendCapUsd + 1e-9) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: `Daily agent-spend cap $${HARD_CAPS.dailySignalSpendCapUsd} would be exceeded (used $${spent.toFixed(2)})`,
    };
  }

  await recordSignalSpend(amountUsd);

  return {
    ok: true,
    simulated: true,
    amountUsd,
    reason: `Simulated agent spend $${amountUsd.toFixed(2)} (guardrailed budget)`,
    premiumHint:
      "Premium hint: prefer maker-style sizing; 1Click unauthenticated fee ~20 bps.",
  };
}
