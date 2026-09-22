import type { Metadata } from "next";
import FomoDepositContent from "./FomoDepositContent";

const TITLE = "Send money to any Fomo username in USDC, no account needed";
const DESCRIPTION =
  "Type a fomo.family username, connect a Solana wallet, and USDC lands in their verified wallet in seconds. No addresses, no sign up. Not on Fomo? Loofta pays anyone by X handle, GitHub, Discord, Telegram or email.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/fomo" },
  openGraph: {
    type: "website",
    url: "/fomo",
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

export default function FomoDepositPage() {
  return <FomoDepositContent />;
}
