'use client'

import { type ReactNode, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { MinimalHeader } from "./MinimalHeader";
import { UserSync } from "./UserSync";
import dynamic from "next/dynamic";
const UpdateJun26Modal = dynamic(() => import("@/components/UpdateJun26Modal").then(m => ({ default: m.UpdateJun26Modal })), { ssr: false });
const MainnetLaunchCelebration = dynamic(() => import("@/components/MainnetLaunchCelebration").then(m => ({ default: m.MainnetLaunchCelebration })), { ssr: false });
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useTranslations } from "next-intl";
import { useUpdateJun26 } from "@/hooks/useUpdateJun26";

function ShellContent({ children }: { children: ReactNode }) {
  const t = useTranslations('AppShell');
  const pathname = usePathname();
  const networkMode = useAuthStore((s) => s.networkMode);
  const { show: updateShow, resolved: updateResolved } = useUpdateJun26();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, [pathname]);

  const isCheckoutPage = pathname?.startsWith('/checkout') === true;
  const showBottomNav = !isCheckoutPage && (
    pathname === '/' || pathname === '/app' ||
    pathname === '/history' || pathname === '/app/history' ||
    pathname === '/settings' || pathname === '/app/settings' || pathname === '/app/profile' ||
    pathname?.startsWith('/c/') || pathname?.startsWith('/app/c/') ||
    pathname === '/sparks' || pathname === '/app/sparks' ||
    pathname === '/megapot' || pathname === '/app/megapot'
  );
  const showMinimalHeader = !isCheckoutPage;
  const showBanner = showMinimalHeader && !bannerDismissed;
  const showFooter = !isCheckoutPage;

  const bannerText = networkMode === "mainnet" ? t('bannerMainnet') : t('bannerDevnet');
  const bannerLink = (
    <a
      href="https://t.me/looftapay"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-white hover:underline underline-offset-2"
    >
      {t('bannerContact')}
      <ChevronRight className="h-4 w-4" />
    </a>
  );

  return (
    <>
      <UserSync />
      <UpdateJun26Modal show={updateShow} />
      <MainnetLaunchCelebration blockedByUpdate={!updateResolved || updateShow} />
      {showBanner && (
        <div className="relative w-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] py-3 mb-3 flex items-center text-white overflow-hidden">
          {/* Mobile: single-line scrolling ticker */}
          <div className="sm:hidden w-full overflow-hidden pr-10">
            <div className="animate-marquee whitespace-nowrap inline-block text-sm font-medium">
              <span>{bannerText}</span>
              <span className="mx-4 opacity-60">·</span>
              {bannerLink}
              <span className="mx-10" />
              <span>{bannerText}</span>
              <span className="mx-4 opacity-60">·</span>
              {bannerLink}
              <span className="mx-10" />
            </div>
          </div>

          {/* Desktop: centered static */}
          <div className="hidden sm:flex flex-wrap items-center justify-center gap-x-2 gap-y-1 min-w-0 text-center flex-1 px-4">
            <span className="text-sm font-medium">{bannerText}</span>
            {bannerLink}
          </div>

          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/20 transition-colors text-white shrink-0"
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
