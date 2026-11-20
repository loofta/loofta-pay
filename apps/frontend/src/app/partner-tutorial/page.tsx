import type { Metadata } from "next";
import { Tutorial } from "./Tutorial";

export const metadata: Metadata = {
  title: "Partner payouts tutorial | Loofta",
  description: "A two minute walkthrough of Loofta partner payouts: set up, fund one wallet, pay everyone with one call, and how your creators cash out.",
  alternates: { canonical: "/partner-tutorial" },
};

export default function Page() {
  return <Tutorial />;
}
