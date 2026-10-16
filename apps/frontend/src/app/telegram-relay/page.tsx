"use client";

import { useEffect } from "react";

/**
 * Retired. This page used to log in to Telegram on loofta.com (Telegram's widget didn't work on
 * .xyz) and hand the handle back to the app, which left a throwaway Privy user holding each
 * Telegram account. The app now runs on .com and Telegram logs in / connects through Privy's own
 * modal, so this only forwards old links to the app.
 */
export default function TelegramRelayPage() {
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://pay.loofta.com";
    window.location.replace(`${base}/app`);
  }, []);

  return (
    <div className="min-h-screen bg-[#0f0f12] flex items-center justify-center px-4 text-center">
      <p className="text-slate-300 text-base">Connect Telegram from Settings in the Loofta app. Redirecting…</p>
    </div>
  );
}
