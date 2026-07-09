import type { Metadata } from "next";
import SendCryptoPrivatelyContent, { HOW_TO_STEPS } from "./SendCryptoPrivatelyContent";

export const metadata: Metadata = {
  title: "How to Send Crypto Without Revealing Your Wallet Address",
  description:
    "A plain-English guide to sending crypto privately — why reusing a wallet address leaks your payment history, and how to avoid it with stealth addresses, privacy coins, or a private payment link.",
  alternates: {
    canonical: "/guides/send-crypto-privately",
  },
};

export default function Page() {
  const howToJsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to send crypto without revealing your wallet address",
    step: HOW_TO_STEPS.map((step) => ({
      "@type": "HowToStep",
      name: step.name,
      text: step.text,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <SendCryptoPrivatelyContent />
    </>
  );
}
