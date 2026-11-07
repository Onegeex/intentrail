import type { Metadata } from "next";
import "@fontsource/big-shoulders-display/latin-600";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/big-shoulders-display/latin-900";
import "@fontsource-variable/overpass";
import "@fontsource-variable/overpass-mono";
import { Providers } from "@/components/Providers";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

/* Fonts are self-hosted: Big Shoulders (condensed civic signage) and
   Overpass (derived from Highway Gothic). Families are set in globals.css. */

export const metadata: Metadata = {
  title: "IntentRail — seatbelt for AI agents that touch money",
  description:
    "Fail-closed guardrails for agent trades on NEAR Intents. Every proposal runs past ten signals before it can move funds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased overflow-x-hidden"
      >
        <Providers>
          <SiteNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
