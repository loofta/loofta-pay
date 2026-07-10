import type { Metadata } from "next";
import PartnersContent from "./PartnersContent";
import { PARTNERS_FAQ } from "./data";

const TITLE = "For Business — Bring Social Payments Into Your Product";
const DESCRIPTION =
  "Gift, split, reward, and pay out in USDC — public or private — inside your own product. Built for creator platforms, freelance marketplaces, and distributed teams who want to move money for their community.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "crypto gifting integration",
    "embed crypto payments",
    "white label crypto payments",
    "B2B crypto payments API",
    "USDC payouts for platforms",
    "private payments integration",
    "gift card API crypto",
    "payment links for platforms",
  ],
  alternates: {
    canonical: "/partners",
  },
  openGraph: {
    type: "website",
    url: "/partners",
    siteName: "Loofta Pay",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loofta for Business — bring social payments into your product",
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
    mainEntity: PARTNERS_FAQ.map((item) => ({
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
      <PartnersContent />
    </>
  );
}
