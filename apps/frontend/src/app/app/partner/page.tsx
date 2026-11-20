import type { Metadata } from "next";
import { Suspense } from "react";
import { PARTNERS_FAQ } from "@/app/partners/data";
import { PartnerLanding } from "./PartnerLanding";

const TITLE = "Loofta for Business: Pay Clippers, Affiliates and Creators";
const DESCRIPTION =
  "Pay clippers, referral partners and creators by social handle or email, in USDC or any token. They cash out to Venmo, Cash App, Revolut, Zelle or a bank. You earn a share of their fees, and we handle the support.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://pay.loofta.com/partner" },
  openGraph: { type: "website", url: "https://pay.loofta.com/partner", siteName: "Loofta Pay", title: TITLE, description: DESCRIPTION },
};

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PARTNERS_FAQ.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <Suspense fallback={null}>
        <PartnerLanding />
      </Suspense>
    </>
  );
}
