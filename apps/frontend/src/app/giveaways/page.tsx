import type { Metadata } from "next";
import GiveawaysContent from "./GiveawaysContent";
import { GIVEAWAYS_FAQ } from "./data";

export const metadata: Metadata = {
  title: "Run a Crypto Giveaway — Escrow-Funded, On-Chain Draw",
  description:
    "Fund a prize pool in USDC or Megapot tickets, set an entry rule, and let Loofta pick winners with a verifiable on-chain draw and automatic payout. Built for creators, freelancers, and teams.",
  alternates: {
    canonical: "/giveaways",
  },
};

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: GIVEAWAYS_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <GiveawaysContent />
    </>
  );
}
