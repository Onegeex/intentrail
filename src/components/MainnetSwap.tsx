"use client";

import { useEffect, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { WalletConnect } from "@/components/WalletConnect";
import { resetWalletCache, type NearNetwork } from "@/lib/near-wallet";

export function MainnetSwap({ mainnetLiveAllowed }: { mainnetLiveAllowed: boolean }) {
  const [liveMode, setLiveMode] = useState(false);
  const [network, setNetwork] = useState<NearNetwork>("testnet");
  const [riskAck, setRiskAck] = useState(false);

  useEffect(() => {
    resetWalletCache();
  }, [network]);
  useEffect(() => {
    if (!liveMode) {
      setNetwork("testnet");
      setRiskAck(false);
    }
  }, [liveMode]);

  return (
    <div className="rounded-[24px] border border-rule bg-panel-raised">
      <div className="space-y-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <WalletConnect network={network} />
          <label className="flex items-center gap-3 text-ivory">
            <input type="checkbox" className="h-5 w-5" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
            Use mainnet
          </label>
        </div>
        {liveMode && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ivory-dim">
              Network
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-rule px-3 text-ivory"
                value={network}
                onChange={(e) => setNetwork(e.target.value as NearNetwork)}
              >
                <option value="testnet">Testnet</option>
                <option value="mainnet" disabled={!mainnetLiveAllowed}>
                  Mainnet{!mainnetLiveAllowed ? " (turned off by the operator)" : ""}
                </option>
              </select>
            </label>
            <label className="flex items-start gap-3 text-sm text-ivory">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} />
              I understand this can move up to $1 of my funds per swap after I sign.
            </label>
          </div>
        )}
        <AgentPanel demo={false} network={network} liveMode={liveMode} riskAcknowledged={riskAck} mainnetLiveAllowed={mainnetLiveAllowed} />
      </div>
    </div>
  );
}

