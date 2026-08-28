import type { Metadata } from "next";
import GuideBody from "./GuideBody";

export const metadata: Metadata = {
  title: "How Loofta Works",
  description:
    "Everything you can do on Loofta — send payments, payment links, Terminal, deposits and withdrawals, Megapot, giveaways, rewards, and private payments.",
  alternates: {
    canonical: "/how-it-works",
  },
};

export default function Page() {
  return <GuideBody />;
}
