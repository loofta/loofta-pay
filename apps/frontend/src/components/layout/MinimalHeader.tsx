'use client'

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";

const HEADER_HEIGHT = 64;

export function MinimalHeader() {
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const headerRef = useRef<HTMLHeaderElement>(null);

  useEffect(() => {
    if (!headerRef.current) return;
    const setVar = () => {
      document.documentElement.style.setProperty("--header-h", `${HEADER_HEIGHT}px`);
    };
    setVar();
    window.addEventListener("resize", setVar);
    return () => {
      window.removeEventListener("resize", setVar);
      document.documentElement.style.setProperty("--header-h", "0px");
    };
  }, []);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 flex items-center bg-[#0f0f12]"
      style={{ height: HEADER_HEIGHT }}
    >
      <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <Link href="/" className="flex items-center">
            <Image
              src="/loofta.svg"
              alt="Loofta"
              width={120}
              height={36}
              className="h-9 w-auto"
            />
          </Link>
        </div>
        <div className="flex items-center shrink-0">
          {authenticated ? (
            <UserMenu
              username={username}
              email={email}
              isDarkPage={true}
              onLogout={() => logout()}
            />
          ) : (
            <button
              type="button"
              onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
