import type { Metadata } from "next";
import LooftaHomePage from "@/components/home-v4/LooftaHomePage.jsx";

const TITLE = "Loofta: Send money to any @username or email";
const DESCRIPTION =
  "Just type a handle or email and send. They claim it whenever they're ready, in 150+ tokens or straight to their bank.";

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
  return <LooftaHomePage />;
}
