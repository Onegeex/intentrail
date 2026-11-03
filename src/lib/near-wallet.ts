"use client";

import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

export type NearNetwork = "testnet" | "mainnet";

let selectorPromise: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;
let cachedNetwork: NearNetwork | null = null;

function contractFor(network: NearNetwork): string {
  // No arbitrary calls — wallet connect is for identity + future signed intents.
  // wrap.near / wrap.testnet are standard NEP-141 wrappers, not agent-controlled.
  return network === "mainnet" ? "wrap.near" : "wrap.testnet";
}

/**
 * Wallet-only signing. Never accepts, stores, or logs private keys or seeds.
 * Function-call access keys (trade-only, no transfers, low allowance) are the
 * intended production model — see SECURITY.md.
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
  if (!modal || cachedNetwork !== network) {
    modal = setupModal(selector, {
      contractId: contractFor(network),
      // Empty methodNames => wallet will still require explicit user approval
      // per transaction; we do not request a broad function-call key here.
      methodNames: [],
      theme: "dark",
      description:
        "IntentRail never asks for your seed phrase. Every trade needs your approval. Prefer a restricted function-call key (trade-only, no transfers).",
    });
  }
  return modal;
}

export function resetWalletCache() {
  selectorPromise = null;
  modal = null;
  cachedNetwork = null;
}
