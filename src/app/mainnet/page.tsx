import { MainnetSwap } from "@/components/MainnetSwap";
import { isMainnetLiveAllowed } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "IntentRail — a $1 NEAR Intents swap on mainnet",
};

export default function MainnetPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-14 overflow-x-hidden">
      <header className="space-y-4">
        <h1 className="font-display font-black leading-[0.9] tracking-wide text-ivory text-[clamp(3rem,7vw,6rem)]">A $1 mainnet swap</h1>
        <p className="max-w-[56ch] text-lg leading-relaxed text-ivory-dim">
          Separate from the vault. This swaps real tokens through NEAR Intents 1Click, signed in your own wallet, so you can
          see the guard price a live mainnet trade. It has its own limits: $1 a swap and $3 per wallet a day. The vault&apos;s
          limits on the home page don&apos;t apply here.
        </p>
      </header>
      <MainnetSwap mainnetLiveAllowed={isMainnetLiveAllowed()} />
    </main>
  );
}
