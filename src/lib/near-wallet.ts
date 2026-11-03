"use client";

import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { fcKeyScope } from "./fc-key";

export type NearNetwork = "testnet" | "mainnet";

export { fcKeyScope };

let selectorPromise: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;
let cachedNetwork: NearNetwork | null = null;

/**
 * Wallet-only signing. Never accepts, stores, or logs private keys or seeds.
 * Connecting requests a FunctionCallAccessKey scoped to the trade-only contract
 * + method allowlist (wallet holds the key).
 */
export async function getSelector(network: NearNetwork): Promise<WalletSelector> {
  if (selectorPromise && cachedNetwork === network) return selectorPromise;
  cachedNetwork = network;
  selectorPromise = setupWalletSelector({
    network,
    modules: [
      setupMyNearWallet({
        walletUrl:
          network === "mainnet"
            ? "https://app.mynearwallet.com"
            : "https://testnet.mynearwallet.com",
      }),
    ],
  });
  return selectorPromise;
}

export async function getModal(network: NearNetwork): Promise<WalletSelectorModal> {
  const selector = await getSelector(network);
  const scope = fcKeyScope(network);
  if (!modal || cachedNetwork !== network) {
    modal = setupModal(selector, {
      contractId: scope.contractId,
      methodNames: scope.methodNames,
      theme: "dark",
      description:
        `IntentRail requests a trade-only function-call key for ${scope.contractId} ` +
        `(methods: ${scope.methodNames.join(", ")}). Never share a seed phrase. ` +
        `Revoke anytime in MyNearWallet → Security.`,
    });
  }
  return modal;
}

export function resetWalletCache() {
  selectorPromise = null;
  modal = null;
  cachedNetwork = null;
}
