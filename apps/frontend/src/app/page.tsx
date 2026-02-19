'use client'

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SendFlowInApp } from "@/components/app/SendFlowInApp";
import { SendReceiveTabs } from "@/components/app/SendReceiveTabs";

const ClaimPayView = dynamic<{ claimId: string; embedInApp?: boolean }>(
  () => import("@/app/c/[id]/page").then((mod) => ({ default: mod.ClaimPayView })),
  { ssr: false }
);

const SEND_FEE_SOL = "0.0015";

export default function Home() {
  const searchParams = useSearchParams();
  const { authenticated } = useAuth();
  const username = useAuthStore((s) => s.username ?? null);
  const { login: privyLogin } = usePrivy();
  const [activeTab, setActiveTab] = useState<"send" | "receive">(() =>
    searchParams.get("tab") === "receive" ? "receive" : "send"
  );
  useEffect(() => {
    if (searchParams.get("tab") === "receive") setActiveTab("receive");
  }, [searchParams]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [sendStep, setSendStep] = useState<1 | 2 | 3>(1);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [dropdownClosed, setDropdownClosed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchCacheRef = useRef<Map<string, { usernames: string[]; ts: number }>>(new Map());
  const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

  const searchQuery = recipient.replace(/^@/, "").trim().toLowerCase();
  const showDropdown = searchQuery.length >= 2 && !dropdownClosed;

  // Exact email only: no partial match to avoid linking/leaking users
  const isExactEmail = (q: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    const cached = searchCacheRef.current.get(searchQuery);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL_MS) {
      setSuggestions(cached.usernames);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cachedAgain = searchCacheRef.current.get(searchQuery);
      if (cachedAgain && Date.now() - cachedAgain.ts < SEARCH_CACHE_TTL_MS) {
        setSuggestions(cachedAgain.usernames);
        return;
      }
      setLoadingSuggestions(true);
      try {
        if (isExactEmail(searchQuery)) {
          // Only resolve by exact email – no partial email search (privacy)
          const r = await fetch(`/api/users/resolve-recipient?q=${encodeURIComponent(searchQuery)}`);
          const data = await r.json();
          const list = data?.username ? [data.username] : [];
          setSuggestions(list);
          searchCacheRef.current.set(searchQuery, { usernames: list, ts: Date.now() });
        } else {
          const r = await fetch(`/api/users/search-usernames?q=${encodeURIComponent(searchQuery)}`);
          const data = await r.json();
          const list = data.usernames || [];
          setSuggestions(list);
          searchCacheRef.current.set(searchQuery, { usernames: list, ts: Date.now() });
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [recipient]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownClosed(true);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSendContinue = async () => {
    const trimmed = recipient.replace(/^@/, "").trim();
    if (!trimmed) return;
    let resolvedUsername = trimmed.toLowerCase();
    if (trimmed.includes("@")) {
      try {
        const r = await fetch(`/api/users/resolve-recipient?q=${encodeURIComponent(trimmed)}`);
        const data = await r.json();
        if (data?.username) resolvedUsername = data.username;
      } catch {
        // keep
      }
    }
    setSelectedRecipient(resolvedUsername);
    setSendStep(2);
  };

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <SendReceiveTabs activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab)} />

        {/* Cool info area */}
        <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-red-500/10 border border-white/10 px-4 py-3 mb-6">
          <p className="text-sm text-slate-300">
            💳 USDC on Solana = no extra Loofta fee. Private payments use Privacy Cash (fee on receive).
          </p>
        </div>

        {activeTab === "send" && (
          <>
            {sendStep === 3 && claimId ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setClaimId(null);
                      setSelectedRecipient(null);
                      setSendStep(1);
                    }}
                    className="text-slate-400 hover:text-white text-sm font-medium"
                  >
                    ← New payment
                  </button>
                </div>
                <ClaimPayView claimId={claimId} embedInApp />
              </div>
            ) : selectedRecipient ? (
              <SendFlowInApp
                recipientUsername={selectedRecipient}
                initialAmount={amount}
                onBack={() => {
                  setSelectedRecipient(null);
                  setSendStep(1);
                }}
                onClaimCreated={(id) => {
                  setClaimId(id);
                  setSendStep(3);
                }}
              />
            ) : (
              <>
                {!authenticated && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 mb-6">
                    <p className="text-sm text-amber-200">
                      Log in to keep track of this payment and reclaim your money if needed.
                    </p>
                    <button
                      type="button"
                      onClick={() => privyLogin({ loginMethods: ["email"], disableSignup: false })}
                      className="inline-block mt-2 text-sm font-medium text-amber-400 hover:text-amber-300"
                    >
                      Sign in →
                    </button>
                  </div>
                )}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                  <div ref={wrapperRef} className="relative">
                <Label className="text-slate-400 text-sm">Send to</Label>
                <p className="text-xs text-slate-500 mt-0.5 mb-1.5">
                  Loofta @username or exact email – they claim by signing in with that account.
                </p>
                <Input
                  type="text"
                  placeholder="@username or exact email (e.g. name@example.com)"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setDropdownClosed(false);
                  }}
                  onFocus={() => setDropdownClosed(false)}
                  autoComplete="off"
                  className="mt-1.5 h-12 bg-white/5 border-white/10 text-white placeholder:text-slate-500"
                />
                {showDropdown && (
                  <ul className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-white/10 bg-[#1a1a1f] py-1 shadow-lg max-h-48 overflow-auto">
                    {loadingSuggestions ? (
                      <li className="px-3 py-2 text-slate-400 text-sm">Searching…</li>
                    ) : suggestions.length > 0 ? (
                      suggestions.map((u) => (
                        <li key={u}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-white hover:bg-white/10 text-sm"
                            onClick={() => {
                              setRecipient(u);
                              setDropdownClosed(true);
                            }}
                          >
                            <span>@{u}</span>
                            {suggestions.length === 1 && isExactEmail(searchQuery) && (
                              <span className="text-slate-500 text-xs ml-1">(from email)</span>
                            )}
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="px-3 py-2 text-slate-500 text-sm">No users found</li>
                    )}
                  </ul>
                )}
              </div>
              <div>
                <Label className="text-slate-400 text-sm">Amount (USD)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0"
                  step="0.01"
                  className="mt-1.5 h-12 bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-lg"
                />
              </div>
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-xs text-slate-400">
                  Network fee: <span className="text-slate-300 font-medium">{SEND_FEE_SOL} SOL</span> per send (covers claim processing).
                </p>
              </div>
              <Button
                onClick={handleSendContinue}
                disabled={!recipient.trim()}
                className="w-full h-12 rounded-xl font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
              >
                Continue
              </Button>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "receive" && (
          <div className="space-y-4">
            {/* Share your personal link */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
              <p className="text-slate-300 text-sm font-medium">Share your personal link</p>
              {authenticated && username ? (
                <>
                  <p className="text-slate-400 text-sm">
                    Anyone can pay you by opening this link. You receive in your preferred token and chain.
                  </p>
                  <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                    <span className="flex-1 text-sm font-mono text-white truncate">
                      {typeof window !== "undefined" ? `${window.location.origin}/link/@${username}` : `/link/@${username}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const link = typeof window !== "undefined" ? `${window.location.origin}/link/@${username}` : "";
                        navigator.clipboard.writeText(link);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/10 text-slate-300 hover:text-white hover:bg-white/15 text-sm font-medium transition-colors"
                    >
                      {linkCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <Link href="/settings" className="block">
                    <Button variant="outline" className="w-full h-11 rounded-xl border-white/10 text-slate-300 hover:bg-white/5 hover:text-white">
                      Share & settings
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-slate-400 text-sm">
                    Sign in to get a personal link you can share for payments.
                  </p>
                  <button
                    type="button"
                    onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
                    className="w-full h-11 rounded-xl font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-opacity"
                  >
                    Sign in to get your link
                  </button>
                </>
              )}
            </div>

            {/* Create new payment link */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
              <p className="text-slate-300 text-sm font-medium">Create new payment link</p>
              <p className="text-slate-400 text-sm">
                Create a one-off payment request. You choose amount, token, and chain. No account required to create.
              </p>
              <Link href="/claim" className="block">
                <Button variant="outline" className="w-full h-11 rounded-xl border-white/10 text-slate-300 hover:bg-white/5 hover:text-white">
                  Create new payment link
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
