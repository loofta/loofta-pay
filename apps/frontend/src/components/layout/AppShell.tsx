'use client'

import { type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { usePathname } from "next/navigation";

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHomepage = pathname === '/';
  const isPayrollArea = pathname?.startsWith('/payroll') === true;
  const hideShell = isPayrollArea; // Payroll has its own layout
  return (
    <>
      {!hideShell && <Header />}
      {children}
      {!isHomepage && !hideShell && <Footer />}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <ShellContent>{children}</ShellContent>;
}


