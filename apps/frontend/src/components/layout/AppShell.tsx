'use client'

import { type ReactNode, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { MinimalHeader } from "./MinimalHeader";
import { UserSync } from "./UserSync";
import { UpdateJun26Modal } from "@/components/UpdateJun26Modal";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useTranslations } from "next-intl";

function ShellContent({ children }: { children: ReactNode }) {
  const t = useTranslations('AppShell');
  const pathname = usePathname();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, [pathname]);

  const isCheckoutPage = pathname?.startsWith('/checkout') === true;
  const showBottomNav = !isCheckoutPage && (
    pathname === '/' || pathname === '/app' ||
    pathname === '/history' || pathname === '/app/history' ||
    pathname === '/settings' || pathname === '/app/settings' ||
    pathname?.startsWith('/c/') || pathname?.startsWith('/app/c/') ||
    pathname === '/sparks' || pathname === '/app/sparks' ||
    pathname === '/waitlist' || pathname === '/app/waitlist'
  );
  const showMinimalHeader = !isCheckoutPage;
  const showBanner = showMinimalHeader && !bannerDismissed;
  const showFooter = !isCheckoutPage;
  return (
    <>
      <UserSync />
      <UpdateJun26Modal />
      {showBanner && (
        <div className="relative w-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-4 py-3 mb-3 flex items-center justify-center text-white">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 min-w-0 text-center">
            <span className="text-base sm:text-sm font-medium">
              {networkMode === "mainnet"
                ? t('bannerMainnet')
                : t('bannerDevnet')}
            </span>
            <a
              href="https://t.me/looftapay"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 shrink-0 text-base sm:text-sm font-semibold text-white hover:underline underline-offset-2"
            >
              {t('bannerContact')}
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/20 transition-colors text-white"
            aria-label={t('dismissBanner')}
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
