import type { Metadata } from "next";
import PayWithEmailContent from "./PayWithEmailContent";
import { PAY_WITH_EMAIL_FAQ } from "./data";

const TITLE = "Pay Anyone in Stablecoins With Just an Email — No Wallet Needed";
const DESCRIPTION =
  "Send USDC to a freelancer, contributor, or client using only their email or social handle — no wallet address, no ENS, no crypto experience required. They choose how to claim it. Built for creators, freelancers, and distributed teams.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/pay-with-email",
  },
  openGraph: {
    type: "website",
    url: "/pay-with-email",
    siteName: "Loofta Pay",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@looftaxyz",
    creator: "@looftaxyz",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PAY_WITH_EMAIL_FAQ.map((item) => ({
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
      <PayWithEmailContent />
    </>
  );
}
