/** Trade-only FC key scope — safe for client + server (no secrets). */
export const TRADE_ONLY_FC_KEY = {
  mainnetContract: "intents.near",
  testnetContract: "wrap.testnet",
  methodsMainnet: ["execute_intents", "simulate_intents"] as const,
  methodsTestnet: ["near_deposit", "near_withdraw"] as const,
  allowanceYocto: "250000000000000000000000",
} as const;

export function fcKeyScope(network: "testnet" | "mainnet") {
  if (network === "mainnet") {
    return {
      contractId: TRADE_ONLY_FC_KEY.mainnetContract,
      methodNames: [...TRADE_ONLY_FC_KEY.methodsMainnet],
      allowance: TRADE_ONLY_FC_KEY.allowanceYocto,
    };
  }
  return {
    contractId: TRADE_ONLY_FC_KEY.testnetContract,
    methodNames: [...TRADE_ONLY_FC_KEY.methodsTestnet],
    allowance: TRADE_ONLY_FC_KEY.allowanceYocto,
  };
}
