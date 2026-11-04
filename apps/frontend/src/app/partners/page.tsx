import type { Metadata } from "next";
import PartnersContent from "./PartnersContent";
import { PARTNERS_FAQ } from "./data";

const TITLE = "Loofta for Business: Pay Clippers, Affiliates and Creators";
const DESCRIPTION =
  "Pay clippers, referral partners and creators by social handle or email, in USDC or any token. They cash out to Venmo, Cash App, Revolut, Zelle or a bank. You earn a share of their fees, and we handle the support.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "clipper payouts",
    "affiliate payouts",
    "creator payouts",
    "referral payouts",
    "USDC payouts for platforms",
    "Whop alternative",
    "payout API",
    "pay creators worldwide",
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
