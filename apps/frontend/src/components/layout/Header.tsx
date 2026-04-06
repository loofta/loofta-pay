'use client'

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useHistoryModal } from "@/contexts/HistoryModalContext";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { UsernameSetupModal } from "@/components/UsernameSetupModal";
import { UserMenu } from "@/components/UserMenu";
import { BalanceModal } from "@/components/BalanceModal";
import { getSolanaBalanceUSD } from "@/services/solanaBalance";
import { useAuthStore } from "@/store/auth";
import { useCallback } from "react";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { looftaXyz } from "@/lib/looftaXyzUrls";

export function Header() {
  const { authenticated, email, userId, logout } = useAuth();
  const { login: privyLogin, user: privyUser, ready: privyReady } = usePrivy();
  // Note: For Solana, we should use useWallets from @privy-io/react-auth/solana
  // But for Header balance fetching, we'll check linkedAccounts instead
  const { openHistory } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  // Check if we're on a dark background page
  const isDarkPage = pathname?.startsWith('/claim') === true || pathname?.startsWith('/c/') === true || pathname?.startsWith('/send') === true || pathname?.startsWith('/s/') === true;
  // About page: transparent blur header with blend so text stays visible on light and dark sections
  const isAboutPage = pathname === '/about';

  // Get username from store (ensure it's string | null, not undefined)
  const username = useAuthStore((s) => s.username ?? null);
  const setUsername = useAuthStore((s) => s.setUsername);

  // Helper to check if a link is active
  const isActive = (href: string) => pathname?.startsWith(href) === true;
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showAccessRequested, setShowAccessRequested] = useState(false);
  const [pendingAccessRequest, setPendingAccessRequest] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceUSD, setBalanceUSD] = useState<string>("0.00");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const productMenuRef = useRef<HTMLDivElement>(null);

  // Handle email-only login
  const handleRequestAccess = () => {
    privyLogin({
      loginMethods: ['email'],
      disableSignup: false,
    });
  };

  // Check user and get username from backend (only for username, not wallet/balance)
  useEffect(() => {
    if (!authenticated || !userId) {
      setUsername(null);
      setBalanceUSD("0.00");
      return;
    }

    const checkUser = async () => {
      try {
        // Only check/create user and get username from backend
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            privyUserId: userId,
            email: email,
          }),
        });

        const userData = await userResponse.json();

        if (userData.user) {
          // Store username in session/store (ensure it's set even if null initially)
          const usernameValue = userData.user.username || null;
          setUsername(usernameValue);

          // Also update email in store if available
          if (userData.user.email) {
            useAuthStore.getState().setAuth({
              authenticated: true,
              userId: userId,
              email: userData.user.email,
              username: usernameValue,
            });
          }

          // Log for debugging
          if (!usernameValue) {
            console.warn("[Header] User exists but username is null:", {
              userId: userData.user.privyUserId,
              email: userData.user.email,
            });
          }

          // Onboarding (add-email, add-Twitter, username step) shows after login; no separate username modal
        }
      } catch (error) {
        console.error("[Header] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email]);

  // Fetch balance from Solana wallet (client-side, from Privy session)
  useEffect(() => {
    if (!authenticated || !privyUser) {
      setBalanceUSD("0.00");
      setSolanaAddress(null);
      return;
    }

    const fetchBalance = async () => {
      // Get Solana wallet from linked accounts (these are wallets tied to user)
      const linkedAccounts = privyUser?.linkedAccounts || [];
      const linkedWallets = linkedAccounts.filter(
        (account: any) => account.type === 'wallet' || account.type === 'smart_wallet'
      );

      // Find Solana wallet by address format (base58, 32-44 chars)
      const solanaLinkedWallet = linkedWallets.find((account: any) => {
        // @ts-ignore
        const address = account.address;
        return address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      });

      if (!solanaLinkedWallet) {
        // Wallet not found in linked accounts
        console.log("[Header] ❌ Solana wallet not found in linked accounts");
        console.log("[Header] Linked accounts:", linkedAccounts.length);
        setBalanceUSD("0.00");
        setSolanaAddress(null);
        return;
      }

      // @ts-ignore
      const addr = solanaLinkedWallet.address;
      setSolanaAddress(addr);
      console.log("[Header] ✅ Found Solana wallet for balance:", addr);

      setLoadingBalance(true);
      try {
        // Fetch balance directly from Solana RPC (client-side)
        const balance = await getSolanaBalanceUSD(addr);
        setBalanceUSD(balance.toFixed(2));
      } catch (error) {
        console.error("[Header] Error fetching Solana balance:", error);
        setBalanceUSD("0.00");
      } finally {
        setLoadingBalance(false);
      }
    };

    // Wait a bit for Privy to initialize
    const timeout = setTimeout(fetchBalance, 1000);

    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [authenticated, privyUser]);

  const refreshBalance = useCallback(async () => {
    if (solanaAddress) {
      setLoadingBalance(true);
      try {
        const balance = await getSolanaBalanceUSD(solanaAddress);
        setBalanceUSD(balance.toFixed(2));
      } catch (error) {
        console.error("[Header] Error refreshing balance:", error);
      } finally {
        setLoadingBalance(false);
      }
    }
  }, [solanaAddress]);

  // Allow other pages (e.g. send-payment claim success) to open the Balance/Withdraw modal and refresh
  useEffect(() => {
    const handler = () => {
      setShowBalanceModal(true);
      refreshBalance();
    };
    window.addEventListener("openBalanceModal", handler);
    return () => window.removeEventListener("openBalanceModal", handler);
  }, [refreshBalance]);

  // Show success message when user authenticates after requesting access
  useEffect(() => {
    if (authenticated && pendingAccessRequest) {
      setShowAccessRequested(true);
      setPendingAccessRequest(false);
    }
  }, [authenticated, pendingAccessRequest]);

  useEffect(() => {
    const updateHeaderVar = () => {
      const h = headerRef.current?.offsetHeight || 0;
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty('--header-h', `${h}px`);
      }
    };
    updateHeaderVar();
    window.addEventListener('resize', updateHeaderVar);
    return () => {
      window.removeEventListener('resize', updateHeaderVar);
    };
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Close product dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productMenuRef.current && !productMenuRef.current.contains(e.target as Node)) {
        setProductMenuOpen(false);
      }
    };
    if (productMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [productMenuOpen]);

  return (
    <div
      ref={headerRef}
      className={`fixed inset-x-0 top-0 z-50 isolate ${isAboutPage
        ? 'bg-transparent border-b border-transparent backdrop-blur-md supports-[backdrop-filter]:bg-white/10'
        : isDarkPage
          ? 'bg-[#0f0f12]/95 border-b border-white/10'
          : 'bg-white/95 border-b border-gray-200'
        }`}
      style={isAboutPage ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : { backdropFilter: 'blur(10px)' }}
    >
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        <div className="flex justify-between items-center animate-fade-in">
          <LooftaPayLogoLink
            imageWidth={120}
            imageHeight={44}
            badgeVariant={isDarkPage ? "on-dark" : "on-light"}
          />

          <div className="flex items-center gap-1">
            {/* Desktop menu items */}
            {/* Product dropdown */}
            <div className="hidden sm:block relative" ref={productMenuRef}>
              <button
                type="button"
                onClick={() => setProductMenuOpen((o) => !o)}
                className={`flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isActive('/swap') || isActive('/b2b') || isActive('/checkout') || isActive('/partners')
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                  : isDarkPage
                    ? 'text-white/90 hover:text-white hover:bg-white/10'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                  }`}
              >
                Products
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${productMenuOpen ? 'rotate-180' : ''}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {productMenuOpen && (
                <div className={`absolute top-full left-0 mt-1 py-1 min-w-[180px] rounded-xl shadow-lg border ${isDarkPage ? 'bg-slate-900/95 border-white/10' : 'bg-white border-gray-200'}`}>
                  <Link
                    href={looftaXyz.checkout}
                    onClick={() => setProductMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors first:rounded-t-[11px] last:rounded-b-[11px] ${isDarkPage ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-100'}`}
                  >
                    B2B Checkout
                  </Link>
                  <Link
                    href={looftaXyz.swap}
                    onClick={() => setProductMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors first:rounded-t-[11px] last:rounded-b-[11px] ${isDarkPage ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-100'}`}
                  >
                    Swaps
                  </Link>
                  <Link
                    href={looftaXyz.partners}
                    onClick={() => setProductMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors first:rounded-t-[11px] last:rounded-b-[11px] ${isDarkPage ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-100'}`}
                  >
                    Partners
                  </Link>
                </div>
              )}
            </div>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* On about page: single "Send & Receive" to app home; else Send + Request links */}
            {isAboutPage ? (
              <Link
                href="/"
                prefetch
                className="hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              >
                Send & Receive
              </Link>
            ) : (
              <>
                <Link
                  href="/send"
                  prefetch
                  className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isActive('/send')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                    : isDarkPage
                      ? 'text-white/90 hover:text-white hover:bg-white/10'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Send payment
                </Link>
                <Link
                  href="/claim"
                  prefetch
                  className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isActive('/claim')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                    : isDarkPage
                      ? 'text-white/90 hover:text-white hover:bg-white/10'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Request a payment
                </Link>
              </>
            )}
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* contact us link */}
            <a
              href="https://t.me/looftaxyz"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              Contact Us
            </a>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* Watch Demo Link */}
            <a
              href="https://www.loom.com/share/fc8337f8a7ed407fa59d68cbdb11fc6f"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-current">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
              </svg>
              Watch Demo
            </a>

            {showHistory && (
              <>
                <Button
                  className="hidden sm:flex bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg"
                  onClick={openHistory}
                >
                  History
                </Button>
              </>
            )}
            {!authenticated ? (
              <>
                {isAboutPage ? (
                  <Link
                    href="/"
                    prefetch
                    className="hidden sm:flex font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 hover:opacity-90 text-white border-0 items-center justify-center"
                    style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                  >
                    Login / Create Account
                  </Link>
                ) : (
                  <Button
                    className="hidden sm:flex font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 hover:opacity-90 text-white border-0"
                    style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                    onClick={handleRequestAccess}
                  >
                    Login / Create Account
                  </Button>
                )}
                {/* Mobile burger menu button */}
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className={`sm:hidden p-2 rounded-lg transition-all ${isDarkPage
                    ? 'text-white hover:bg-white/10'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  aria-label="Open menu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </button>
              </>
            ) : (
              <>
                {!isAboutPage && (
                  <>
                    {/* Balance Display – click to open Balance & Withdraw modal */}
                    <button
                      type="button"
                      onClick={() => setShowBalanceModal(true)}
                      className={`hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isDarkPage ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      <span className="text-sm font-medium">Balance:</span>
                      <span className="text-sm font-semibold">
                        {loadingBalance ? "..." : `$${balanceUSD}`}
                      </span>
                    </button>
                    <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
                    {/* User Menu with Dropdown */}
                    <UserMenu
                      username={username || null}
                      email={email}
                      isDarkPage={isDarkPage}
                      onLogout={() => {
                        setUsername(null); // Clear username from store
                        logout();
                      }}
                    />
                  </>
                )}
                {/* Mobile burger menu button */}
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className={`sm:hidden p-2 rounded-lg transition-all ${isDarkPage
                    ? 'text-white hover:bg-white/10'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  aria-label="Open menu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu Modal - Rendered via Portal to escape header stacking context */}
      {isMobileMenuOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-white animate-in fade-in duration-200">
          <div className="flex flex-col h-full">
            {/* Header with close button */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <LooftaPayLogoLink imageWidth={100} imageHeight={36} badgeVariant="on-light" />
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Menu items */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <nav className="flex flex-col gap-1">
                <span className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</span>
                <Link
                  href={looftaXyz.checkout}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/b2b') || isActive('/checkout')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                    : 'text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  B2B Checkout
                </Link>
                <Link
                  href={looftaXyz.swap}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/swap')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                    : 'text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Swaps
                </Link>
                <Link
                  href={looftaXyz.partners}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/partners')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                    : 'text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Partners
                </Link>

                <span className="mt-4 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Payments</span>
                {isAboutPage ? (
                  <Link
                    href="/"
                    prefetch
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-gray-900 hover:bg-gray-100 transition-colors"
                  >
                    Send & Receive
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/send"
                      prefetch
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/send')
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                        : 'text-gray-900 hover:bg-gray-100'
                        }`}
                    >
                      Send payment
                    </Link>
                    <Link
                      href="/claim"
                      prefetch
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/claim')
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                        : 'text-gray-900 hover:bg-gray-100'
                        }`}
                    >
                      Request a payment
                    </Link>
                  </>
                )}

                <a
                  href="https://t.me/looftaxyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  Contact Us
                </a>

                <a
                  href="https://www.loom.com/share/fc8337f8a7ed407fa59d68cbdb11fc6f"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-gray-600">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
                  </svg>
                  Watch Demo
                </a>

                {showHistory && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      openHistory();
                    }}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors text-left"
                  >
                    History
                  </button>
                )}

                {authenticated && !isAboutPage && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
                    <div className="px-4 py-2 text-sm font-medium text-gray-900 mb-1">
                      {username ? `@${username}` : email}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        useAuthStore.getState().setOpenShareModal(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors text-left"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                      Share your link
                    </button>
                    <Link
                      href="/payments"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                      Payment history
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      Settings
                    </Link>
                    {/* Balance – open Balance & Withdraw modal */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setShowBalanceModal(true);
                      }}
                      className="w-full text-left px-4 py-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors mb-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Balance</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {loadingBalance ? "..." : `$${balanceUSD}`}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setUsername(null);
                        logout();
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 font-medium hover:bg-red-50 transition-colors text-left"
                    >
                      Log out
                    </button>
                  </>
                )}

                {(!authenticated || isAboutPage) && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
                    {isAboutPage ? (
                      <Link
                        href="/"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                      >
                        {authenticated ? "Open app" : "Login / Create Account"}
                      </Link>
                    ) : (
                      <button
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          handleRequestAccess();
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                      >
                        Login / Create Account
                      </button>
                    )}
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Username Setup Modal */}
      {userId && (
        <UsernameSetupModal
          open={showUsernameModal}
          onClose={() => setShowUsernameModal(false)}
          onSuccess={(newUsername) => {
            setUsername(newUsername); // This is from store
            setShowUsernameModal(false);
          }}
          privyUserId={userId}
        />
      )}

      {/* Balance & Withdraw Modal – opened when clicking balance */}
      {authenticated && (
        <BalanceModal
          open={showBalanceModal}
          onClose={() => setShowBalanceModal(false)}
          balanceUSD={balanceUSD}
          loadingBalance={loadingBalance}
          solanaAddress={solanaAddress}
          onRefresh={refreshBalance}
          dark={isDarkPage}
        />
      )}

      {/* Access Requested Success Modal */}
      {showAccessRequested && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAccessRequested(false)}>
          <div
            className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-8 text-center">
              {/* Success Icon */}
              <div className="flex justify-center mb-6">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(16,185,129,0.15) 100%)' }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-green-500">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                You're on the list!
              </h2>

              {/* Message */}
              <p className="text-gray-600 mb-2">
                Thanks for your interest in Loofta Pay!
              </p>
              <p className="text-gray-500 text-sm mb-6">
                We'll notify you at <span className="font-medium text-gray-700">{email}</span> as soon as we're ready for you.
              </p>

              {/* Party emoji decoration */}
              <div className="flex justify-center gap-2 mb-6">
                <span className="text-3xl">🎉</span>
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setShowAccessRequested(false)}
                className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


