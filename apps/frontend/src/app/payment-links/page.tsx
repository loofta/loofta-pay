import type { Metadata } from "next";
import PaymentLinksContent, { PAYMENT_LINKS_FAQ } from "./PaymentLinksContent";

export const metadata: Metadata = {
  title: "Private Crypto Payment Links — No KYC, No Wallet Exposure",
  description:
    "Create a private crypto payment link and get paid in USDC without exposing your wallet address, balance, or payment history. No KYC, works across chains — built for creators, freelancers, and distributed teams.",
  alternates: {
    canonical: "/payment-links",
  },
};

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PAYMENT_LINKS_FAQ.map((item) => ({
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
      <PaymentLinksContent />
    </>
  );
}
