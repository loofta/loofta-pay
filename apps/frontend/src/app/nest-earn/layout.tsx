import type { ReactNode } from "react";
import "./nest-splash.css";
import "./onboarding.css";

export const revalidate = 0;

// Standalone "Loofta Nest" surface — nest.loofta.xyz rewrites here in prod (see proxy.ts). The
// nest-splash design kit's own page supplies its own header/nav/sign-in (see NestApp.tsx) — this
// layout only loads the design tokens; no AppShell chrome, no second header on top of it.
export default function NestEarnLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
