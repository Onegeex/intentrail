"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastItem = { id: number; message: string; tone: "info" | "ok" | "err" };

const ToastCtx = createContext<{
  push: (message: string, tone?: ToastItem["tone"]) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-4), { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex w-[min(100%-2rem,22rem)] flex-col gap-2 pointer-events-none"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-lg ${
              t.tone === "ok"
                ? "border-emerald-700 bg-emerald-950/90 text-emerald-100"
                : t.tone === "err"
                  ? "border-red-800 bg-red-950/90 text-red-100"
                  : "border-zinc-700 bg-zinc-900/95 text-zinc-100"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    return {
      push: (message: string) => {
        if (typeof window !== "undefined") console.info("[toast]", message);
      },
    };
  }
  return ctx;
}
