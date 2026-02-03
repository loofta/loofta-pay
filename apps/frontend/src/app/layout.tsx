// layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
// Suppress Privy hydration warnings (third-party library issue)
import "@/lib/suppressPrivyWarnings";
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
    default: "Loofta Pay — Multi-Chain Crypto Payments & Private Payments | Request Payments Across Any Blockchain",
    template: "%s | Loofta Pay",
  },
  description:
    "Loofta Pay enables multi-chain crypto payments and private payments. Create payment requests and receive crypto in any token/chain. Your payer uses whatever they want - you always receive exactly what you asked for. Support for 20+ blockchains including Ethereum, Solana, Bitcoin, TON, and more.",
  keywords: [
    "multi-chain payments",
    "cross-chain payments",
    "private payments",
    "crypto payment requests",
    "multi-chain crypto",
    "private crypto payments",
    "crypto payment platform",
    "blockchain payments",
    "cross-chain multi-chain",
    "Zcash private payments",
    "non-custodial payments",
    "crypto invoice",
    "payment request crypto",
    "NEAR intents",
    "DeFi payments",
    "crypto settlement",
  ],
  applicationName: "Loofta Pay",
  generator: "Next.js",
  category: "finance",
  authors: [{ name: "Loofta" }],
  creator: "Loofta",
  publisher: "Loofta",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Loofta Pay",
    title: "Loofta Pay — Multi-Chain Crypto Payments & Private Payments",
    description:
      "Create payment requests and receive crypto in any token/chain. Multi-chain payments and private payments across 20+ blockchains. Your payer uses whatever they want - you always receive exactly what you asked for.",
    images: [{ url: "/loofta.svg", width: 1200, height: 630, alt: "Loofta Pay - Multi-Chain Crypto Payments" }],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@looftaxyz",
    creator: "@looftaxyz",
    title: "Loofta Pay — Multi-Chain Crypto Payments & Private Payments",
    description:
      "Create payment requests and receive crypto in any token/chain. Multi-chain payments and private payments across 20+ blockchains.",
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
  verification: {
    // Add your verification codes if you have them
    // google: "your-google-verification-code",
    // yandex: "your-yandex-verification-code",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} font-grotesk`}>
      <head>
        {/* Preload critical fonts for better LCP */}
        <link
          rel="preload"
          href="//cdn.fontshare.com/wf/VFMK2COV3DN37JR7JQ4CAOJPZ7KWKNY7/ODD5YJNDLHZZB2MIT3DPVH4EIHAMZ34D/BSY64LPTT3OPLVKAZKL3AHKRWZ3D74AC.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="//cdn.fontshare.com/wf/SINQ57HHHPFVR2H2M32ZNEFSVLE2LFD2/7IAKEQYNYVZZQGJW7R4Y7C5IZ7XHSFQO/DKSXVIDJANOLWNE4OACLWSGITSUTBGB3.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Preload critical logo for LCP */}
        <link rel="preload" href="/loofta.svg" as="image" />
        {/* DNS prefetch for external resources */}
        <link rel="dns-prefetch" href="https://cdn.fontshare.com" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
      </head>
      <body className="min-h-[calc(100vh-var(--header-h,0px))] pt-[var(--header-h,0px)] antialiased">
        {/* Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Loofta Pay",
              url: SITE_URL,
              description: "Multi-chain crypto payment platform enabling private payments and payment requests across 20+ blockchains",
              sameAs: [
                "https://x.com/looftapay",
                "https://t.me/looftaxyz",
                "https://medium.com/@looftaxyz",
              ],
              logo: `${SITE_URL}/loofta.svg`,
            }),
          }}
        />
        {/* WebApplication JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Loofta Pay",
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              url: SITE_URL,
              description: "Multi-chain crypto payment platform for creating payment requests and receiving private payments across any blockchain",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              featureList: [
                "Multi-chain payments",
                "Cross-chain payments",
                "Private payments",
                "Payment requests",
                "Non-custodial",
                "20+ blockchain support",
              ],
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
