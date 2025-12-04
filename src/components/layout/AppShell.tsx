'use client'

import { type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { HistoryModalProvider, useHistoryModal } from "@/contexts/HistoryModalContext";
import { HistoryModal } from "@/components/history/HistoryModal";
import { usePathname } from "next/navigation";

function ShellContent({ children }: { children: ReactNode }) {
  const { open, setOpen } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  // Don't show footer on homepage (it has its own footer with different styling)
  const isHomepage = pathname === '/';
  return (
    <>
      <Header />
      {children}
      {!isHomepage && <Footer />}
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


