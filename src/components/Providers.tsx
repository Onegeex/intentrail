"use client";

import { ReactNode } from "react";
import "@near-wallet-selector/modal-ui/styles.css";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
