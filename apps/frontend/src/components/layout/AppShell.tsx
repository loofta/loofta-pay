'use client'

import { type ReactNode, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { MinimalHeader } from "./MinimalHeader";
import { UserSync } from "./UserSync";
import { usePathname } from "next/navigation";

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const isCheckoutPage = pathname?.startsWith('/checkout') === true;
  const showBottomNav = !isCheckoutPage && (pathname === '/' || pathname === '/history' || pathname === '/settings' || pathname?.startsWith('/c/'));
  const showMinimalHeader = !isCheckoutPage;
  const showBanner = showMinimalHeader && !bannerDismissed;
  const showFooter = !isCheckoutPage;
  return (
    <>
      <UserSync />
      {showBanner && (
        <div className="relative w-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-4 py-3 mb-3 flex items-center justify-center text-white">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 min-w-0 text-center">
            <span className="text-sm font-medium">
              Send and receive private payments with MagicBlock PER — devnet only. Pay anyone by email, X username, or Loofta username.
            </span>
            <a
              href="https://t.me/looftapay"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 shrink-0 text-sm font-semibold text-white hover:underline underline-offset-2"
            >
              Questions? Contact us on Telegram
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/20 transition-colors text-white"
            aria-label="Dismiss banner"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {showMinimalHeader && <MinimalHeader />}
      <main className={showBottomNav ? "pb-20 md:pb-0" : undefined}>
        {children}
      </main>
      {showFooter && <Footer />}
      {showBottomNav && <BottomNav />}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <ShellContent>{children}</ShellContent>;
}


