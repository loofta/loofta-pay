"use client";

import { useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { Manrope } from "next/font/google";
import { UserMenu } from "@/components/UserMenu";
import PartnersContent from "@/app/partners/PartnersContent";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-landing-sans", display: "swap" });

/**
 * The partner front door, for everyone: what Loofta payouts are, the tutorial, and Sign in. People who are signed in get an
 * "Open the portal" button, and the portal itself lives at /partner/portal. Old links that carry a portal parameter (an
 * invite, a batch to approve) are sent straight to the portal.
 */
export function PartnerLanding() {
  const params = useSearchParams();
  const { ready, authenticated, login, logout, email } = useAuth();
  const username = useAuthStore((st) => st.username ?? null);
  const emailLogin = useCallback(() => void login({ loginMethods: ["email"], disableSignup: false }), [login]);

  const forPortal = ["invite", "org", "batch", "tab"].some((k) => params.has(k));
  useEffect(() => {
    if (forPortal) window.location.replace(`/partner/portal${window.location.search}`);
  }, [forPortal]);
  if (forPortal) return null;

  return (
    <div
      className={`${manrope.variable} min-h-screen overflow-x-hidden text-[#1D1D1F]`}
      style={{
        fontFamily: "var(--font-landing-sans), -apple-system, BlinkMacSystemFont, sans-serif",
        background:
          "radial-gradient(900px 520px at 50% 105%, rgba(255,150,110,0.18), rgba(255,150,110,0) 70%), radial-gradient(700px 500px at 92% 0%, rgba(255,196,170,0.28), rgba(255,196,170,0) 70%), #FAFAFB",
      }}
    >
      <header className="flex items-center justify-between gap-4 border-b border-black/[0.05] px-[clamp(20px,3.5vw,48px)] py-5">
        <a href="https://loofta.com/" aria-label="Loofta">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/loofta.svg" alt="Loofta" className="h-[26px] w-auto" />
        </a>
        <div className="flex items-center gap-6 text-[15px] text-[#6E6E73]">
          <a href="/docs" className="hidden transition-colors hover:text-[#1D1D1F] sm:inline">Docs</a>
          <a href="mailto:hello@loofta.xyz" className="hidden transition-colors hover:text-[#1D1D1F] sm:inline">Support</a>
          {!ready ? null : authenticated ? (
            <UserMenu username={username} email={email} isDarkPage={false} onLogout={() => void logout()} />
          ) : (
            <button type="button" onClick={emailLogin} className="rounded-full border border-black/[0.08] bg-white px-4 py-2 font-medium text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#F2F2F4]">
              Sign in
            </button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-[1240px] px-[clamp(20px,5vw,72px)] pb-24 pt-[clamp(40px,8vh,96px)]">
        <PartnersContent portal={{ onSignIn: emailLogin, signedIn: ready && authenticated }} />
      </div>
      <footer className="flex flex-wrap justify-between gap-4 px-[clamp(20px,3.5vw,48px)] py-6 text-[14px] text-[#86868B]">
        <span className="flex gap-5"><a href="/terms" className="hover:text-[#1D1D1F]">Terms</a><a href="/privacy" className="hover:text-[#1D1D1F]">Privacy</a></span>
        <span className="flex gap-5"><a href="/docs" className="hover:text-[#1D1D1F]">Docs</a><a href="mailto:hello@loofta.xyz" className="hover:text-[#1D1D1F]">Support</a></span>
      </footer>
    </div>
  );
}
