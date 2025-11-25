// layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { AppShell } from "@/components/layout/AppShell";
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const revalidate = 0;

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://swap.loofta.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Loofta — Cross‑Chain Swap | Bridge tokens across networks",
    template: "%s | Loofta",
  },
  description:
    "Loofta is a simple, secure cross‑chain swap. Bridge and swap tokens across networks with a single deposit.",
  keywords: [
    "cross-chain swap",
    "bridge",
    "swap tokens",
    "multi-chain",
    "crypto bridge",
    "swap across chains",
    "crosschain",
    "DeFi",
    "NEAR intents",
  ],
  applicationName: "Loofta",
  generator: "Next.js",
  category: "finance",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Loofta",
    title: "Loofta — Cross‑Chain Swap",
    description:
      "Swap and bridge tokens across chains with one deposit.",
    images: [{ url: "/loofta.svg", width: 1200, height: 630, alt: "Loofta" }],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@looftaxyz",
    creator: "@looftaxyz",
    title: "Loofta — Cross‑Chain Swap",
    description:
      "Swap and bridge tokens across chains with one deposit.",
    images: ["/loofta.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} font-grotesk`}>
      <body className="antialiased">
        {/* Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Loofta",
              url: SITE_URL,
              sameAs: [
                "https://x.com/looftaxyz",
                "https://t.me/looftaxyz",
                "https://medium.com/@looftaxyz",
              ],
              logo: `${SITE_URL}/loofta.svg`,
            }),
          }}
        />
        <AuthProvider>
          <QueryProvider>
            <AppShell>
              {children}
            </AppShell>
          </QueryProvider>
        </AuthProvider>
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
