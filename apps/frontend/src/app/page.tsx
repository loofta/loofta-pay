import type { Metadata } from "next";
import HomeContent from "./HomeContent";

export const metadata: Metadata = {
  title: "Private Crypto Payment Links — Send & Receive USDC Privately",
  description:
    "Create a private crypto payment link in seconds. Loofta shields amounts and counterparties so you can send or receive USDC privately across chains — built for creators, freelancers, and distributed teams, no KYC required.",
  alternates: {
    canonical: "/",
  },
};

export default function Page() {
  return <HomeContent />;
}
