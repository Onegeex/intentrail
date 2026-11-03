"use client";

import { useCallback, useEffect, useState } from "react";

export function KillSwitch() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/kill-switch");
    const data = await res.json();
    if (data.ok) setOn(Boolean(data.killSwitch));
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !on,
          reason: !on ? "user toggled from UI" : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "failed");
      setOn(Boolean(data.killSwitch));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        className={`rounded-lg px-3 py-2 text-sm font-semibold border transition ${
          on
            ? "bg-red-600 border-red-400 text-white"
            : "bg-emerald-700/40 border-emerald-500/50 text-emerald-100 hover:bg-emerald-600/50"
        }`}
      >
        {on ? "KILL SWITCH ON" : "Kill switch off"}
      </button>
      {err && <span className="text-red-300 text-xs">{err}</span>}
    </div>
  );
}
