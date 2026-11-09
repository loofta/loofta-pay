import type { Metadata } from "next";
import PlayContent from "./PlayContent";

const TITLE = "Loofta World: run through 19 countries and cash out USDC";
const DESCRIPTION =
  "A 30 second game. Dodge the fees, grab the USDC, run into a new country. Then see what $100 of USDC turns into in naira, rupees, pesos, euros and more.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/play" },
  openGraph: {
    type: "website",
    url: "/play",
    siteName: "Loofta Pay",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: TITLE }],
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

export default function PlayPage() {
  return <PlayContent />;
}
