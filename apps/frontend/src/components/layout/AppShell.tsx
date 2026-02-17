'use client'

import { type ReactNode } from "react";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { MinimalHeader } from "./MinimalHeader";
import { UserSync } from "./UserSync";
import { HistoryModalProvider, useHistoryModal } from "@/contexts/HistoryModalContext";
import { HistoryModal } from "@/components/history/HistoryModal";
import { usePathname } from "next/navigation";

function ShellContent({ children }: { children: ReactNode }) {
  const { open, setOpen } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  const isCheckoutPage = pathname?.startsWith('/checkout') === true;
  const showBottomNav = !isCheckoutPage && (pathname === '/' || pathname === '/history' || pathname === '/settings' || pathname?.startsWith('/c/'));
  const isAboutPage = pathname === '/about';
  const showMinimalHeader = !isCheckoutPage && !isAboutPage;
  return (
    <>
      <UserSync />
      {isAboutPage && <Header />}
      {showMinimalHeader && <MinimalHeader />}
      <main className={showBottomNav ? "pb-20 md:pb-0" : undefined}>
        {children}
      </main>
      {!isCheckoutPage && <Footer />}
      {showBottomNav && <BottomNav />}
      {showHistory && <HistoryModal open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HistoryModalProvider>
      <ShellContent>{children}</ShellContent>
    </HistoryModalProvider>
  );
}


