import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claim your payment — Loofta Link",
  description: "Verify who you are once, claim to any wallet, everywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Providers>
          <div className="flex-1">{children}</div>
          <footer className="py-4 text-center text-xs text-slate-500">
            Powered by{" "}
            <a
              href="https://loofta.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-slate-300"
            >
              Loofta
            </a>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
