import type { Metadata } from "next";
import HomeV3Content from "./home-v3/HomeV3Content";

const TITLE = "Send USDC to Anyone — Email or Social Handle";
const DESCRIPTION =
  "Send USDC to anyone with just an email address or social handle — no wallet required. They claim it in 150+ tokens or straight to their bank. Flip on Shielded mode to keep sender and recipient private. Built for creators, freelancers, and distributed teams.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
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
  return <HomeV3Content />;
}
