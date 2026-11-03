import { HomeClient } from "@/components/HomeClient";
import { isMainnetLiveAllowed } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeClient mainnetLiveAllowed={isMainnetLiveAllowed()} />;
}
