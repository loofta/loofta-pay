import type { Metadata } from "next";
import UsdcToNgnContent from "./UsdcToNgnContent";
import { USDC_TO_NGN_FAQ } from "./data";
import { getUsdcNgnRateSnapshot } from "@/lib/usdcNgnRate";

export const dynamic = "force-dynamic";

const TITLE = "USDC to Naira (NGN) — Live Rate & Calculator";
const DESCRIPTION =
  "Convert USDC to naira at the real market rate, not the official bank rate. Live calculator, and direct payout to any Nigerian bank account, no wallet needed to receive.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/usdc-to-ngn",
  },
  openGraph: {
    type: "website",
    url: "/usdc-to-ngn",
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
    mainEntity: USDC_TO_NGN_FAQ.map((item) => ({
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
      <UsdcToNgnContent initialSnapshot={initialSnapshot} />
    </>
  );
}
