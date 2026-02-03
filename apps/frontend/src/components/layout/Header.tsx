'use client'

import Image from "next/image";
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
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";
import { BalanceModal } from "@/components/BalanceModal";
import { getSolanaBalanceUSD } from "@/services/solanaBalance";
import { useAuthStore } from "@/store/auth";
import { useCallback } from "react";

export function Header() {
  const { authenticated, email, userId, logout } = useAuth();
  const { login: privyLogin, user: privyUser, ready: privyReady } = usePrivy();
  // Note: For Solana, we should use useWallets from @privy-io/react-auth/solana
  // But for Header balance fetching, we'll check linkedAccounts instead
  const { openHistory } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  // Check if we're on a dark background page
  const isDarkPage = pathname?.startsWith('/claim') === true || pathname?.startsWith('/c/') === true;

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
  const [showWelcomeOnboarding, setShowWelcomeOnboarding] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceUSD, setBalanceUSD] = useState<string>("0.00");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);

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

          // Show username modal if user needs to set username
          if (userData.needsUsername) {
            setShowUsernameModal(true);
          } else if (userData.user.username) {
            // User has username - check if we should show welcome onboarding
            // Show onboarding if user just completed setup (check localStorage)
            const hasSeenOnboarding = localStorage.getItem("loofta.hasSeenWelcomeOnboarding");
            if (!hasSeenOnboarding) {
              // Check if wallet exists - if yes, show onboarding
              // We'll check this in a separate effect
            }
          }
        }
      } catch (error) {
        console.error("[Header] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email]);

  // Check if we should show welcome onboarding (user + wallet ready)
  // Always show until user opts out via "don't show again" checkbox
  useEffect(() => {
    if (!authenticated || !username || !privyReady || !privyUser || !userId) {
      return;
    }

    // Check user's onboarding preference from database
    const checkOnboardingPreference = async () => {
      try {
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            privyUserId: userId,
            email: email,
          }),
        });

        const userData = await userResponse.json();

        // If user has opted out, don't show onboarding
        if (userData.user?.skipOnboarding) {
          return;
        }

        // Check if Solana wallet exists in linked accounts (even if not connected)
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

        // Show onboarding when both username and wallet are ready
        // Wait a bit after username modal closes (if it was shown)
        // @ts-ignore
        if (username && solanaLinkedWallet?.address && !showUsernameModal) {
          // Small delay to ensure everything is rendered
          const timer = setTimeout(() => {
            setShowWelcomeOnboarding(true);
          }, 1500);
          return () => clearTimeout(timer);
        }
      } catch (error) {
        console.error("[Header] Error checking onboarding preference:", error);
      }
    };

    checkOnboardingPreference();
  }, [authenticated, username, privyUser, privyReady, showUsernameModal, userId, email]);

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

  return (
    <div ref={headerRef} className="fixed inset-x-0 top-0 z-50" style={{ backdropFilter: 'blur(10px)' }}>
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        <div className="flex justify-between items-center animate-fade-in">
          <Link href="/" prefetch className="relative inline-block hover:opacity-90 transition-opacity">
            <Image
              src="/loofta.svg"
              alt="Loofta Pay"
              width={120}
              height={44}
            />
            <span
              className="absolute -top-4 -right-6 text-lg font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              pay
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {/* Desktop menu items */}
            {/* Swap link */}
            <Link
              href="/swap"
              prefetch
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isActive('/swap')
                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                : isDarkPage
                  ? 'text-white/90 hover:text-white hover:bg-white/10'
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              Swap
            </Link>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* Make a payment link */}
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
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* B2B Checkout link */}
            <Link
              href="/b2b"
              prefetch
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isActive('/b2b')
                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm'
                : isDarkPage
                  ? 'text-white/90 hover:text-white hover:bg-white/10'
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              B2B Checkout
            </Link>
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
                <Button
                  className="hidden sm:flex font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 hover:opacity-90 text-white border-0"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                  onClick={handleRequestAccess}
                >
                  Login / Create Account
                </Button>
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
              <Image
                src="/loofta.svg"
                alt="Loofta Pay"
                width={100}
                height={36}
              />
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
                <Link
                  href="/swap"
                  prefetch
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/swap')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                    : 'text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  Swap
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

                <Link
                  href="/b2b"
                  prefetch
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive('/b2b')
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                    : 'text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  B2B Checkout
                </Link>

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

                {authenticated && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
                    {/* Balance in mobile menu – click to open Balance & Withdraw modal */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setShowBalanceModal(true);
                      }}
                      className="w-full text-left px-4 py-2 bg-gray-50 rounded-lg mb-2 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Balance:</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {loadingBalance ? "..." : `$${balanceUSD}`}
                        </span>
                      </div>
                    </button>
                    <div className="px-4 py-2 text-sm text-gray-600 mb-2">
                      {username ? `@${username}` : email}
                    </div>
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setUsername(null); // Clear username from store
                        logout();
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-red-600 font-medium hover:bg-red-50 transition-colors text-left"
                    >
                      Log out
                    </button>
                  </>
                )}

                {!authenticated && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
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

      {/* Welcome Onboarding Modal - rendered in portal to center on screen */}
      {username && userId && (
        <WelcomeOnboarding
          open={showWelcomeOnboarding}
          onClose={(dontShowAgain) => {
            setShowWelcomeOnboarding(false);
            // Preference is saved to database in the component itself
            // Refresh user data to get updated username
            if (authenticated && userId) {
              // Trigger a refresh of user data
              const refreshUser = async () => {
                try {
                  const userResponse = await fetch("/api/users/check", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      privyUserId: userId,
                      email: email,
                    }),
                  });
                  const userData = await userResponse.json();
                  if (userData.user?.username) {
                    setUsername(userData.user.username);
                  }
                } catch (error) {
                  console.error("[Header] Error refreshing user:", error);
                }
              };
              refreshUser();
            }
          }}
          username={username}
          privyUserId={userId}
          onEditUsername={async () => {
            // Refresh user data after username is saved
            if (authenticated && userId) {
              try {
                const userResponse = await fetch("/api/users/check", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    privyUserId: userId,
                    email: email,
                  }),
                });
                const userData = await userResponse.json();
                if (userData.user?.username) {
                  setUsername(userData.user.username);
                }
              } catch (error) {
                console.error("[Header] Error refreshing user:", error);
              }
            }
          }}
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


