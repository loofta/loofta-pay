'use client'

import { type ReactNode, useEffect } from "react";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { MinimalHeader } from "./MinimalHeader";
import { UserSync } from "./UserSync";
import dynamic from "next/dynamic";
const UpdateJun26Modal = dynamic(() => import("@/components/UpdateJun26Modal").then(m => ({ default: m.UpdateJun26Modal })), { ssr: false });
const MainnetLaunchCelebration = dynamic(() => import("@/components/MainnetLaunchCelebration").then(m => ({ default: m.MainnetLaunchCelebration })), { ssr: false });
import { usePathname } from "next/navigation";
import { useUpdateJun26 } from "@/hooks/useUpdateJun26";
import { useUnclaimedPaymentToast } from "@/hooks/useUnclaimedPaymentToast";
import { UnclaimedPaymentToast } from "@/components/UnclaimedPaymentToast";
import { useAddEmailToast } from "@/hooks/useAddEmailToast";
import { AddEmailToast } from "@/components/AddEmailToast";
import { useTerminalPromoToast } from "@/hooks/useTerminalPromoToast";
import { TerminalPromoToast } from "@/components/TerminalPromoToast";
import { useUnclaimedGiftToast } from "@/hooks/useUnclaimedGiftToast";
import { UnclaimedGiftToast } from "@/components/UnclaimedGiftToast";
import { useFreeSpinToast } from "@/hooks/useFreeSpinToast";
import { FreeSpinToast } from "@/components/FreeSpinToast";

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { show: updateShow, resolved: updateResolved } = useUpdateJun26();
  const { unclaimed, dismiss: dismissUnclaimed } = useUnclaimedPaymentToast();
  const { showAddEmail, addEmail, linking: addingEmail, error: addEmailError, dismiss: dismissAddEmail } = useAddEmailToast();
  const { showTerminalPromo, dismiss: dismissTerminalPromo } = useTerminalPromoToast();
  const { unclaimed: unclaimedGifts, dismiss: dismissUnclaimedGifts } = useUnclaimedGiftToast();
  const { hasFreeSpin, dismiss: dismissFreeSpin } = useFreeSpinToast();
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }, [pathname]);

  const isCheckoutPage = pathname?.startsWith('/checkout') === true;
  // Mystery Pack is a full-screen immersive page sized as calc(100svh - var(--header-h,0px)) —
  // that var only tracks MinimalHeader's own height, not this banner's, so showing it here would
  // push the pack canvas down by an unaccounted amount (the same overlap bug the header itself
  // used to have, one layer up).
  const isImmersivePage = pathname?.startsWith('/megapot/packs') || pathname?.startsWith('/app/megapot/packs');
  const showBottomNav = !isCheckoutPage && (
    pathname === '/' || pathname === '/app' ||
    pathname === '/history' || pathname === '/app/history' ||
    pathname === '/settings' || pathname === '/app/settings' || pathname === '/app/profile' || pathname === '/profile' ||
    pathname?.startsWith('/c/') || pathname?.startsWith('/app/c/') ||
    pathname === '/sparks' || pathname === '/app/sparks' ||
    pathname === '/megapot' || pathname === '/app/megapot'
  );
  const showMinimalHeader = !isCheckoutPage;
  const showFooter = !isCheckoutPage;

  return (
    <>
      <UserSync suppressOnboarding={isCheckoutPage} />
      {/* Checkout is meant to feel like a self-contained payment page (Stripe-style) — none of
          these promo/update overlays belong on top of someone else's embedded payment flow. */}
      {!isCheckoutPage && <UpdateJun26Modal show={updateShow} />}
      {!isCheckoutPage && <MainnetLaunchCelebration blockedByUpdate={!updateResolved || updateShow} />}
      {!isCheckoutPage && (unclaimed || unclaimedGifts || (hasFreeSpin && !isImmersivePage) || showAddEmail || showTerminalPromo) && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:bottom-4 z-[100] sm:max-w-sm flex flex-col-reverse gap-3">
          {unclaimed && <UnclaimedPaymentToast payments={unclaimed} onDismiss={dismissUnclaimed} />}
          {unclaimedGifts && <UnclaimedGiftToast gifts={unclaimedGifts} onDismiss={dismissUnclaimedGifts} />}
          {/* Suppressed on the Mystery Pack page itself (isImmersivePage) — nudging someone to go
              open a free spin while they're already there is redundant, and the page's own
              SlideToPay gate already surfaces it (see packs/page.tsx). */}
          {hasFreeSpin && !isImmersivePage && <FreeSpinToast onDismiss={dismissFreeSpin} />}
          {showAddEmail && (
            <AddEmailToast
              onAddEmail={addEmail}
              onDismiss={dismissAddEmail}
              loading={addingEmail}
              alreadyLinked={addEmailError === "already_linked"}
            />
          )}
          {showTerminalPromo && <TerminalPromoToast onDismiss={dismissTerminalPromo} />}
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
