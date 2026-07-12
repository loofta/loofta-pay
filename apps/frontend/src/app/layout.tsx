// layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
// Suppress Privy hydration warnings (third-party library issue)
import "@/lib/suppressPrivyWarnings";
import { Analytics } from "@vercel/analytics/next"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const SITE_URL = (process as any)?.env?.NEXT_PUBLIC_SITE_URL || "https://loofta.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Loofta Pay — Send & receive private payments",
    template: "%s | Loofta Pay",
  },
  description:
    "Send and receive private payments with Loofta Pay. Non-custodial payment requests and settlement across the chains and assets you already use.",
  keywords: [
    "private crypto payments",
    "private payment link",
    "send crypto privately",
    "send USDC privately",
    "private payment link generator",
    "no KYC crypto payments",
    "stealth payments crypto",
    "non-custodial payments",
    "multi-chain payments",
    "confidential payments",
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
    title: "Loofta Pay — Send & receive private payments",
    description:
      "Send and receive private payments. Non-custodial payment requests and settlement across the chains and assets you already use.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loofta Pay — Send & Receive Private Payments.",
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@looftaxyz",
    creator: "@looftaxyz",
    title: "Loofta Pay — Send & receive private payments",
    description:
      "Send and receive private payments. Non-custodial payment requests and settlement across the chains and assets you already use.",
    images: ["/og-image.png"],
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${inter.variable} font-grotesk`} suppressHydrationWarning>
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
        {/* Preload balance modal tab icons so they're cached before the modal opens */}
        <link rel="preload" href="/images/icons/deposit-bridge.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/images/icons/deposit-receive.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/images/icons/deposit-bank.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/images/icons/withdraw-usdc.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/images/icons/withdraw-peer.svg" as="image" type="image/svg+xml" />
        {/* DNS prefetch for external resources */}
        <link rel="dns-prefetch" href="https://cdn.fontshare.com" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
      </head>
      <body className="min-h-[calc(100vh-var(--header-h,0px))] antialiased bg-[#0f0f12]">
        {/* Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Loofta Pay",
              url: SITE_URL,
              description: "Send and receive private payments with non-custodial payment requests across multiple chains",
              sameAs: [
                "https://x.com/looftapay",
                "https://t.me/looftapay",
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
              description: "Send and receive private payments; create payment requests and settle across the chains you use",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              featureList: [
                "Private payments",
                "Send and receive payments",
                "Payment requests",
                "Non-custodial",
                "Multi-chain settlement",
              ],
            }),
          }}
        />
        <NextIntlClientProvider messages={messages}>
          <AppErrorBoundary>
            <AuthProvider>
              <QueryProvider>
                {children}
              </QueryProvider>
            </AuthProvider>
          </AppErrorBoundary>
        </NextIntlClientProvider>
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
