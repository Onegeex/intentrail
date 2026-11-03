import { HARD_CAPS } from "./config";
import { getSignalSpentToday, getState, recordSignalSpend } from "./store";
import type { SignalPayment } from "./types";

/**
 * Agent Economy — agent "pays" a tiny fee for a premium signal.
 * Simulated micro-payment; per-call + daily caps checked fail-closed.
 * Never moves real chain funds or touches private keys.
 */
export async function buyPremiumSignal(): Promise<SignalPayment> {
  const amountUsd = HARD_CAPS.signalFeeUsd;
  if (amountUsd > HARD_CAPS.maxSignalFeePerCallUsd + 1e-9) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: `Signal fee exceeds per-call cap $${HARD_CAPS.maxSignalFeePerCallUsd}`,
    };
  }

  const state = await getState();
  if (state.killSwitch || state.untrusted) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: "Kill switch / untrusted state — signal purchase blocked",
    };
  }

  const spent = await getSignalSpentToday();
  if (spent + amountUsd > HARD_CAPS.dailySignalSpendCapUsd + 1e-9) {
    return {
      ok: false,
      simulated: true,
      amountUsd,
      reason: `Daily signal cap $${HARD_CAPS.dailySignalSpendCapUsd} would be exceeded (used $${spent.toFixed(2)})`,
    };
  }

  await recordSignalSpend(amountUsd);

  return {
    ok: true,
    simulated: true,
    amountUsd,
    reason: `Paid $${amountUsd.toFixed(2)} simulated signal fee (agent-economy)`,
    premiumHint:
      "Premium: prefer maker-style sizing; 1Click unauthenticated fee ~20 bps.",
  };
}
