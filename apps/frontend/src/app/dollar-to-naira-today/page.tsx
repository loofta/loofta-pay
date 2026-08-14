import type { Metadata } from "next";
import DollarToNairaContent from "./DollarToNairaContent";
import { DOLLAR_TO_NAIRA_FAQ } from "./data";
import { getUsdcNgnRateSnapshot } from "@/lib/usdcNgnRate";

export const dynamic = "force-dynamic";

const TITLE = "Dollar to Naira Today — Live Rate & Bank Payout";
const DESCRIPTION =
  "Today's dollar to naira rate, and a direct way to receive it. Anyone can send you dollars with just your email or handle, no bank details upfront, paid out to your Nigerian bank at the real market rate.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/dollar-to-naira-today",
  },
  openGraph: {
    type: "website",
    url: "/dollar-to-naira-today",
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

export default async function Page() {
  const initialSnapshot = await getUsdcNgnRateSnapshot();

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: DOLLAR_TO_NAIRA_FAQ.map((item) => ({
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
      <DollarToNairaContent initialSnapshot={initialSnapshot} />
    </>
  );
}
