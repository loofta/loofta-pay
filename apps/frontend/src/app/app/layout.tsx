import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";

export const revalidate = 0;

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
