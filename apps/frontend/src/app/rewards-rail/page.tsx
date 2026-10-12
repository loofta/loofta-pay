import type { Metadata } from "next";
import { RewardsRail } from "@/components/rewards-rail/RewardsRail";

export const metadata: Metadata = {
  title: "Loofta Rewards",
  description: "Set up a giveaway in USDC, any Solana token, or Jackpot tickets. Entrants join from the public giveaways page.",
};

export default function RewardsRailPage() {
  return <RewardsRail />;
}
