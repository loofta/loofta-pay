"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

/**
 * The root layout's AuthProvider (apps/frontend/src/providers/AuthProvider.tsx) deliberately
 * excludes "telegram" from its loginMethods — that provider wraps the whole app, and Telegram's
 * widget doesn't work on the .xyz app domain, so exposing it there would just recreate the same
 * broken entry point everywhere (see TELEGRAM_SEND_ENABLED). But that means the relay page —
 * nested inside that same root provider like every other route — never got telegram enabled
 * either, which is very likely why Privy's SDK reports "Telegram Auth configuration is not
 * loaded" here specifically. Nesting a second, telegram-only PrivyProvider around just this route
 * scopes the fix to this one page: usePrivy() inside telegram-relay/page.tsx resolves to this
 * inner provider (nearest wins in React context), while every other route keeps using the outer
 * one from the root layout, unaffected.
 */
export default function TelegramRelayLayout({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  return (
    <PrivyProvider appId={appId} config={{ loginMethods: ["telegram"] }}>
      {children}
    </PrivyProvider>
  );
}
