import type { Metadata } from "next";
import { StakeToWin } from "@/components/stake/StakeToWin";

export const metadata: Metadata = {
  title: "Stake to win",
  description: "Stake your USDC and get a shot at weekly rewards, without risking your deposit.",
};

export default function StakePage() {
  return <StakeToWin />;
}
