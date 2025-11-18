// layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { HistorySync } from "@/providers/HistorySync";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Loofta",
  description: "Loofta mini-app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} font-grotesk`}>
      <body className="antialiased">
        <AuthProvider>
          <QueryProvider>
            {children}
            <HistorySync />
          </QueryProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
