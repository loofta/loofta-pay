"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePrivy, useUser, useWallets, useLinkAccount } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useAuthStore } from "@/store/auth";
import { getCachedMainnetAccess, setCachedMainnetAccess } from "@/lib/mainnetAccessCache";
import { getTierForVolume } from "@/lib/tiers";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { PRIVATE_PAYMENT_ENABLED } from "@/services/privatePayment";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
/** Privy uses type "twitter_oauth" for Twitter (not "twitter" or "x"). */
const TWITTER_TYPES = ["twitter_oauth", "twitter", "x"] as const;

/** Twitter/X handle from Privy linked accounts (username || name || subject). */
function getTwitterUsername(linkedAccounts: Array<{ type?: string; username?: string; name?: string; subject?: string }> | undefined): string | null {
  const tw = (linkedAccounts || []).find((a) => a.type && TWITTER_TYPES.includes(a.type as any));
  if (!tw) return null;
  const raw = (tw as { username?: string; name?: string; subject?: string }).username
    || (tw as { name?: string }).name
    || (tw as { subject?: string }).subject
    || "";
  const s = String(raw).replace(/^@/, "").toLowerCase().trim();
  return s.length >= 3 ? s : null;
}

function formatVolume(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${n / 1000}k`;
  return `$${n}`;
}

function TierBadge({ volumeUsd, dark }: { volumeUsd: number; dark: boolean }) {
  const info = getTierForVolume(volumeUsd);
  const thresholds = [1000, 50000, 100000, 1000000];
  const nextThreshold = thresholds.find((t) => t > volumeUsd);
  const next = nextThreshold ? `${formatVolume(nextThreshold)} to next tier` : null;
  return (
    <div className={`flex items-center justify-between mt-2 pt-2 pb-1 border-t ${dark ? "border-white/10" : "border-gray-200"}`}>
      <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${info.color} ${info.bg}`}>
        {info.label}
      </span>
      {next && (
        <span className={`text-sm ${dark ? "text-gray-500" : "text-gray-400"}`}>{next}</span>
      )}
    </div>
  );
}

interface UserMenuProps {
  username: string | null;
  email: string | undefined;
  isDarkPage: boolean;
  onLogout: () => void;
}

export function UserMenu({ username: usernameProp, email: emailProp, isDarkPage, onLogout }: UserMenuProps) {
  const t = useTranslations('UserMenu');
  // Get email and username from store as fallback (always persistent)
  const storeEmail = useAuthStore((s) => s.email);
  const storeUsername = useAuthStore((s) => s.username ?? null);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUsername = useAuthStore((s) => s.setUsername);

  // Use props if available, otherwise fallback to store
  const username = usernameProp ?? storeUsername;
  const email = emailProp ?? storeEmail;

  const mainnetAccess = useAuthStore((s) => s.mainnetAccess);
  const networkMode = useAuthStore((s) => s.networkMode);
  const setMainnetAccess = useAuthStore((s) => s.setMainnetAccess);
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode);
  const tier = useAuthStore((s) => s.tier);
  const totalVolumeUsd = useAuthStore((s) => s.totalVolumeUsd);
  const setTier = useAuthStore((s) => s.setTier);

  const openShareModalFromStore = useAuthStore((s) => s.openShareModal);
  const setOpenShareModal = useAuthStore((s) => s.setOpenShareModal);
  const openSettingsModalFromStore = useAuthStore((s) => s.openSettingsModal);
  const setOpenSettingsModal = useAuthStore((s) => s.setOpenSettingsModal);

  // Sync props to store to ensure persistence
  useEffect(() => {
    if (emailProp || usernameProp !== undefined) {
      setAuth({
        authenticated: true,
        email: emailProp ?? storeEmail,
        username: usernameProp ?? storeUsername,
      });
    }
  }, [emailProp, usernameProp, storeEmail, storeUsername, setAuth]);

  // Open share modal when requested from elsewhere (e.g. payments page, settings page)
  useEffect(() => {
    if (openShareModalFromStore) {
      setShowShareModal(true);
      setOpenShareModal(false);
    }
  }, [openShareModalFromStore, setOpenShareModal]);

  // Open settings modal when requested from elsewhere (e.g. settings page / Profile tab)
  useEffect(() => {
    if (openSettingsModalFromStore) {
      setShowSettingsModal(true);
      setOpenSettingsModal(false);
    }
  }, [openSettingsModalFromStore, setOpenSettingsModal]);

  const [isOpen, setIsOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [showFullAddress, setShowFullAddress] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [requirePrivatePayments, setRequirePrivatePayments] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [updatingPreferences, setUpdatingPreferences] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);
  useEffect(() => {
    setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [updatingToTwitter, setUpdatingToTwitter] = useState(false);
  const [twitterLinkedOptimistic, setTwitterLinkedOptimistic] = useState(false);
  const [linkingMethod, setLinkingMethod] = useState<"twitter" | "email" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ready: privyReady, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { linkTwitter, linkEmail } = useLinkAccount({
    onSuccess: async (arg: { linkedAccount?: { type?: string }; linkMethod?: string } | undefined) => {
      const linkedType = arg?.linkedAccount?.type;
      const didLinkTwitter =
        linkedType === "twitter_oauth" ||
        linkedType === "twitter" ||
        linkedType === "x" ||
        arg?.linkMethod === "twitter" ||
        linkingMethod === "twitter";
      if (didLinkTwitter) {
        setTwitterLinkedOptimistic(true);
      }
      setLinkingMethod(null);
      // Force Privy to re-fetch the user so linkedAccounts is immediately up to date.
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Account linked", description: "Sign-in method added successfully." });
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
      setLinkingMethod(null);
      if (/already been linked|already linked|linked to another user/i.test(msg)) {
        const isTwitterConflict = linkingMethod === "twitter" || /twitter|x|oauth/i.test(msg);
        toast({
          variant: "destructive",
          title: isTwitterConflict ? "X account already in use" : "Email already in use",
          description: isTwitterConflict
            ? "This X account is already linked to another user. Use another X account or sign in to the existing account."
            : "This email is linked to another account. Sign in with that email to use it.",
        });
      } else {
        toast({ variant: "destructive", title: "Could not link", description: msg || "Try again." });
      }
    },
  });
  const { exportWallet } = useExportWallet();
  const { wallets } = useWallets();
  const { toast } = useToast();
  const { balanceUSD } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated === true });

  const linkedAccounts = (privyUser?.linkedAccounts || []) as Array<{ type?: string; username?: string; name?: string; address?: string; subject?: string }>;
  const hasTwitter = linkedAccounts.some((a) => a.type && TWITTER_TYPES.includes(a.type as any));
  const hasTwitterLinked = hasTwitter || twitterLinkedOptimistic;
  const hasEmail = linkedAccounts.some((a) => a.type === "email");
  const twitterHandle = useMemo(() => getTwitterUsername(linkedAccounts), [linkedAccounts]);
  const linkedEmailAddress = useMemo(() => {
    const acc = linkedAccounts.find((a) => a.type === "email");
    return acc && "address" in acc ? (acc as { address: string }).address : null;
  }, [linkedAccounts]);
  const canUpdateToTwitter = hasTwitterLinked && twitterHandle && username !== twitterHandle;

  // Get Solana wallet address from Privy
  // Use linkedAccounts - these are wallets tied to user (what shows in Privy dashboard)
  useEffect(() => {
    if (!privyReady || !authenticated || !privyUser) {
      console.log("[UserMenu] Waiting for Privy to be ready...", { privyReady, authenticated, hasUser: !!privyUser });
      return;
    }

    // Comprehensive logging
    console.log("=== [UserMenu] PRIVY SOLANA WALLET DEBUG ===");
    console.log("[UserMenu] Privy ready:", privyReady);
    console.log("[UserMenu] Privy user:", privyUser);

    // Check linked accounts (these are wallets tied to user, may not be connected)
    // According to Privy docs: "Linked wallets are embedded or external wallets tied to a user object"
    const linkedAccounts = privyUser?.linkedAccounts || [];
    console.log("[UserMenu] Linked accounts (all):", linkedAccounts);

    // Filter for wallet accounts
    const linkedWallets = linkedAccounts.filter(
      (account: any) => account.type === 'wallet' || account.type === 'smart_wallet'
    );
    console.log("[UserMenu] Linked wallets (filtered):", linkedWallets);

    // Find Solana wallet in linked accounts
    // Solana addresses are base58 encoded, typically 32-44 characters
    const solanaLinkedAccount = linkedWallets.find((account: any) => {
      // @ts-ignore - LinkedAccount types may vary
      const address = account.address;
      if (!address) return false;

      // Check if it's a Solana wallet by address format (base58, 32-44 chars)
      const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

      // Also check chainType/chainId if available
      // @ts-ignore
      const isSolanaChain = account.chainType === "solana" ||
        account.chainId === "solana:mainnet" ||
        account.chainId === "solana:devnet" ||
        account.chainId?.includes("solana");

      console.log("[UserMenu] Linked wallet check:", {
        // @ts-ignore
        type: account.type,
        address: address,
        // @ts-ignore
        chainType: account.chainType,
        // @ts-ignore
        chainId: account.chainId,
        isSolanaAddress,
        isSolanaChain,
        willMatch: isSolanaAddress || isSolanaChain,
      });

      return isSolanaAddress || isSolanaChain;
    });

    if (solanaLinkedAccount) {
      // @ts-ignore
      const linkedAddress = solanaLinkedAccount.address;
      console.log("[UserMenu] ✅ Found Solana wallet in linked accounts:", linkedAddress);
      setWalletAddress(linkedAddress);
    } else {
      console.log("[UserMenu] ❌ No Solana wallet found in linked accounts");
      console.log("[UserMenu] Linked accounts count:", linkedAccounts.length);
      console.log("[UserMenu] Linked wallets count:", linkedWallets.length);
    }
    console.log("=== [UserMenu] END DEBUG ===");
  }, [privyReady, authenticated, privyUser]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const formatAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const copyToClipboard = (text: string, isLink: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isLink) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getPaymentLink = () => {
    if (!username) return null;
    const baseUrl = typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.xyz";
    return `${baseUrl}/link/@${username}`;
  };

  // Fetch user preferences when modal opens
  useEffect(() => {
    if (showShareModal && authenticated && getAccessToken && privyUser?.id) {
      const fetchPreferences = async () => {
        setLoadingPreferences(true);
        try {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
          const token = await getAccessToken();
          const response = await fetch(`${backendUrl}/users/me/preferences`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          if (response.ok) {
            const data = await response.json();
            setRequirePrivatePayments(data.requirePrivatePayments || false);
          } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('Failed to fetch preferences:', errorData);
          }
        } catch (error) {
          console.error('Failed to fetch preferences:', error);
        } finally {
          setLoadingPreferences(false);
        }
      };
      fetchPreferences();
    }
  }, [showShareModal, authenticated, getAccessToken, privyUser?.id]);

  // Fetch mainnet access on every login/mount — always re-fetch so newly granted access is picked up immediately.
  // Apply cached value first for instant UI, then overwrite with fresh API response.
  useEffect(() => {
    if (!authenticated || !getAccessToken || !privyUser?.id) return;
    const userId = privyUser.id;
    const cached = getCachedMainnetAccess(userId);
    if (cached !== null) {
      setMainnetAccess(cached);
    }
    const check = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/users/mainnet-access", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const { mainnetAccess: access } = await res.json();
          setMainnetAccess(!!access);
          setCachedMainnetAccess(userId, !!access);
        }
      } catch { /* non-critical */ }
    };
    check();
  }, [authenticated, privyUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user tier (volume-based status) on mount
  useEffect(() => {
    if (!authenticated || !getAccessToken || !privyUser?.id) return;
    const fetchTier = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
        const token = await getAccessToken();
        const res = await fetch(`${backendUrl}/users/me/tier`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const { tier: t, totalVolumeUsd: vol } = await res.json();
          setTier(t, vol);
        }
      } catch { /* non-critical */ }
    };
    fetchTier();
  }, [authenticated, privyUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update user preferences
  const handleTogglePrivatePayments = async (checked: boolean) => {
    if (!authenticated || !getAccessToken || !privyUser?.id) return;

    setUpdatingPreferences(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const token = await getAccessToken();
      const response = await fetch(`${backendUrl}/users/me/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ requirePrivatePayments: checked }),
      });

      if (response.ok) {
        setRequirePrivatePayments(checked);
        toast({
          title: "Settings updated",
          description: checked
            ? "Your payment link now requires private payments only."
            : "Your payment link now accepts both standard and private payments.",
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to update preferences:', errorData);
        throw new Error(errorData.message || 'Failed to update preferences');
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update privacy preferences. Please try again.",
      });
    } finally {
      setUpdatingPreferences(false);
    }
  };

  const copyPaymentLink = () => {
    const link = getPaymentLink();
    if (link) {
      copyToClipboard(link, true);
    }
  };

  const shareToTelegram = () => {
    const link = getPaymentLink();
    if (link) {
      const text = encodeURIComponent(`Pay me on Loofta Pay: ${link}`);
      window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`, '_blank');
    }
  };

  const shareToWhatsApp = () => {
    const link = getPaymentLink();
    if (link) {
      const text = encodeURIComponent(`Pay me on Loofta Pay: ${link}`);
      window.open(`https://wa.me/?text=${text}`, '_blank');
    }
  };

  const shareToEmail = () => {
    const link = getPaymentLink();
    if (link) {
      const subject = encodeURIComponent('Pay me on Loofta Pay');
      const body = encodeURIComponent(`Hi,\n\nYou can pay me using this link: ${link}\n\nThanks!`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Username Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (isOpen) {
            setShowFullAddress(false);
          }
        }}
        className={`hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${isDarkPage
          ? "text-white/90 hover:text-white hover:bg-white/10"
          : "text-gray-700 hover:text-gray-900 hover:bg-gray-100"
          }`}
      >
        <span className="text-base md:text-sm font-medium">{username || email}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg border z-50 ${isDarkPage
            ? "bg-gray-900 border-gray-700"
            : "bg-white border-gray-200"
            }`}
        >
          <div className="p-2">
            {/* User Info Section */}
            <div className={`px-3 py-2 rounded-lg mb-1 ${isDarkPage ? "bg-gray-800" : "bg-gray-50"
              }`}>
              {username && (
                <div className="mb-2">
                  <p className={`text-base md:text-sm font-medium mb-1 ${isDarkPage ? "text-gray-400" : "text-gray-500"
                    }`}>
                    {t('username')}
                  </p>
                  <div className="flex items-center justify-between">
                    <p className={`text-base md:text-sm font-semibold ${isDarkPage ? "text-white" : "text-gray-900"
                      }`}>
                      @{username}
                    </p>
                    <button
                      onClick={() => copyToClipboard(`@${username}`)}
                      className={`p-1 rounded hover:bg-opacity-20 ${isDarkPage ? "hover:bg-white" : "hover:bg-gray-200"
                        }`}
                      title={t('copyUsername')}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={isDarkPage ? "text-gray-400" : "text-gray-500"}
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>

                </div>
              )}

              {email && (
                <div className="mb-2">
                  <p className={`text-base md:text-sm font-medium mb-1 ${isDarkPage ? "text-gray-400" : "text-gray-500"
                    }`}>
                    {t('email')}
                  </p>
                  <div className="flex items-center justify-between">
                    <p className={`text-base md:text-sm ${isDarkPage ? "text-white/90" : "text-gray-700"
                      }`}>
                      {email}
                    </p>
                  </div>
                </div>
              )}

              {/* Tier badge */}
              <TierBadge volumeUsd={totalVolumeUsd} dark={isDarkPage} />

            </div>

            {/* Divider */}
            <div className={`h-px my-2 ${isDarkPage ? "bg-gray-700" : "bg-gray-200"
              }`}></div>

            {/* Share Payment Link Section */}
            {username && (
              <div className="mb-2">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setShowShareModal(true);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors flex items-center gap-2 ${isDarkPage
                    ? "text-orange-400 hover:bg-orange-400/10"
                    : "text-orange-600 hover:bg-orange-50"
                    }`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                    <polyline points="16 6 12 2 8 6"></polyline>
                    <line x1="12" y1="2" x2="12" y2="15"></line>
                  </svg>
                  {t('shareYourLink')}
                </button>
              </div>
            )}



            {/* Rewards */}
            <div className="mb-2">
              <Link
                href="/rewards"
                onClick={() => setIsOpen(false)}
                className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors flex items-center gap-2 ${isDarkPage
                  ? "text-amber-400 hover:bg-amber-400/10"
                  : "text-amber-600 hover:bg-amber-50"
                  }`}
              >
                <span>⚡</span>
                {t('sparks')}
              </Link>
            </div>

            {/* Settings - opens modal with wallet address & export private keys */}
            <div className="mb-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setShowSettingsModal(true);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors flex items-center gap-2 ${isDarkPage
                  ? "text-gray-300 hover:bg-gray-800"
                  : "text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                {t('settings')}
              </button>
            </div>

            {/* Network toggle — visible to all; non-mainnetAccess users get view-only mainnet */}
            <div className="mb-2">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${isDarkPage ? "hover:bg-gray-800" : "hover:bg-gray-100"}`}>
                <div className="flex flex-col min-w-0">
                  <span className={`text-base md:text-sm ${isDarkPage ? "text-gray-300" : "text-gray-700"}`}>
                    {networkMode === "mainnet"
                      ? (mainnetAccess ? t('mainnetBeta') : t('mainnetViewOnly'))
                      : t('devnet')}
                  </span>
                  {networkMode === "mainnet" && !mainnetAccess && (
                    <span className="text-base md:text-sm text-amber-400/80 leading-tight">{t('paymentsDisabled')}</span>
                  )}
                </div>
                <Switch
                  checked={networkMode === "mainnet"}
                  onCheckedChange={(checked) => setNetworkMode(checked ? "mainnet" : "devnet")}
                />
              </div>
            </div>

            {/* Divider */}
            {username && (
              <div className={`h-px my-2 ${isDarkPage ? "bg-gray-700" : "bg-gray-200"
                }`}></div>
            )}

            {/* Logout Button */}
            <button
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors ${isDarkPage
                ? "text-red-400 hover:bg-red-400/10"
                : "text-red-600 hover:bg-red-50"
                }`}
            >
              {t('logOut')}
            </button>
          </div>
        </div>
      )}

      {/* Share Modal - matching onboarding style */}
      {showShareModal && (() => {
        const modalContent = !username ? (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowShareModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden p-8 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-6 text-5xl">💳</div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('noUsernameTitle')}</h2>
                <p className="text-base text-gray-600 mb-6">
                  {t('noUsernameBody')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="rounded-2xl bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  {t('gotIt')}
                </button>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex flex-col sm:items-center sm:justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowShareModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-[#0f0f12] sm:border sm:border-white/10 sm:rounded-2xl w-full sm:max-w-md shadow-2xl flex flex-col h-full sm:h-auto overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 text-white">
                  {/* Icon */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6 flex justify-center"
                  >
                    <div
                      className="w-24 h-24 rounded-full flex items-center justify-center mx-auto bg-white/10"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,15,0,0.2) 0%, rgba(234,179,8,0.2) 100%)",
                      }}
                    >
                      <motion.div
                        animate={{ rotate: [0, 10, -10, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        className="text-6xl"
                      >
                        💰
                      </motion.div>
                    </div>
                  </motion.div>

                  {/* Header */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-center mb-6"
                  >
                    <h2 className="text-2xl font-bold text-white mb-2">
                      {t('shareModalTitle')}
                    </h2>
                    <p className="text-base text-slate-400">
                      {t('shareModalSubtitle')}
                    </p>
                  </motion.div>

                  {/* Payment Link Display */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10"
                  >
                    <p className="text-base md:text-sm font-medium mb-2 text-slate-400">
                      {t('yourPaymentLink')}
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={getPaymentLink() || ""}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-base md:text-sm font-mono truncate hover:underline text-orange-400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {getPaymentLink()?.replace(/^https?:\/\//, "") || ""}
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPaymentLink();
                        }}
                        className={`p-2 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 ${linkCopied ? "text-green-400" : "text-slate-400"}`}
                        title={linkCopied ? t('copied') : t('copyLink')}
                      >
                        {linkCopied ? (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        ) : (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        )}
                      </button>
                    </div>
                  </motion.div>

                  {/* Private payment status */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-semibold text-white">
                          {t('privatePayments')}
                        </span>
                        {PRIVATE_PAYMENT_ENABLED ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm md:text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            {t('enabled')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm md:text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {t('comingSoon')}
                          </span>
                        )}
                      </div>

                    </div>
                    <p className="text-base md:text-sm text-slate-400 mt-3 w-full block">
                      {PRIVATE_PAYMENT_ENABLED
                        ? t('privatePaymentsDescEnabled')
                        : t('privatePaymentsDescDisabled')}
                    </p>
                  </motion.div>

                  {/* Share Buttons */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="grid grid-cols-3 gap-3 mb-6"
                  >
                    {/* Telegram */}
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        shareToTelegram();
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-slate-300">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.12l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
                      </svg>
                      <span className="text-base md:text-sm font-medium text-slate-300">
                        Telegram
                      </span>
                    </motion.button>

                    {/* WhatsApp */}
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        shareToWhatsApp();
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-slate-300">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                      <span className="text-base md:text-sm font-medium text-slate-300">
                        WhatsApp
                      </span>
                    </motion.button>

                    {/* Email */}
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        shareToEmail();
                      }}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                      </svg>
                      <span className="text-base md:text-sm font-medium text-slate-300">
                        Email
                      </span>
                    </motion.button>
                  </motion.div>

                  {/* Copy Button */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPaymentLink();
                      }}
                      className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                      style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
                    >
                      {linkCopied ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          {t('copied')}
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                          {t('copyLinkButton')}
                        </span>
                      )}
                    </button>
                  </motion.div>
                </div>

                {/* Sticky close footer */}
                <div className="shrink-0 px-6 pb-8 sm:pb-5 pt-3 border-t border-white/10 bg-[#0f0f12]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowShareModal(false);
                    }}
                    className="w-full py-3.5 rounded-xl font-semibold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    {t('close')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        );

        // Render in portal to body to ensure proper centering
        if (typeof window !== "undefined") {
          return createPortal(modalContent, document.body);
        }
        return null;
      })()}

      {/* Settings Modal - full screen on mobile, card on desktop */}
      {showSettingsModal && typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col sm:items-center sm:justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowSettingsModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-[#0f0f12] sm:border sm:border-white/10 sm:rounded-2xl w-full sm:max-w-sm shadow-2xl flex flex-col h-full sm:h-auto overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-6 text-white">
                {/* Header */}
                <div className="text-center mb-6">
                  <div className="mb-3 flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                      <Settings className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-1">{t('settingsTitle')}</h2>
                  <p className="text-base md:text-sm text-gray-400">{t('settingsSubtitle')}</p>
                </div>

                <div className="space-y-4">
            {/* Network toggle — visible to all */}
            <div>
              <Label className="text-base md:text-sm font-medium mb-2 block text-gray-300">{t('network')}</Label>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex flex-col min-w-0">
                  <span className="text-base md:text-sm text-white/90">
                    {networkMode === "mainnet"
                      ? (mainnetAccess ? t('mainnetBeta') : t('mainnetViewOnly'))
                      : t('devnet')}
                  </span>
                  {networkMode === "mainnet" && !mainnetAccess && (
                    <span className="text-base md:text-sm text-amber-400/80 mt-0.5">{t('balanceWithdrawOnly')}</span>
                  )}
                </div>
                <Switch
                  checked={networkMode === "mainnet"}
                  onCheckedChange={(checked) => setNetworkMode(checked ? "mainnet" : "devnet")}
                />
              </div>
            </div>

            {/* Sign-in methods - show connected first, then Add buttons */}
            <div>
              <Label className="text-base md:text-sm font-medium mb-2 block text-gray-300">{t('signInMethods')}</Label>
              {/* Always show what's already connected */}
              {(hasEmail || hasTwitterLinked) && (
                <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                  <p className="text-base md:text-sm font-medium text-gray-400 mb-1.5">{t('connected')}</p>
                  {hasEmail && linkedEmailAddress && (
                    <div className="flex items-center gap-2 text-base md:text-sm text-white/90">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-gray-400">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                      </svg>
                      <span className="truncate">{linkedEmailAddress}</span>
                    </div>
                  )}
                  {hasTwitterLinked && twitterHandle && (
                    <div className="flex items-center gap-2 text-base md:text-sm text-white/90">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-gray-400">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      <span>@{twitterHandle}</span>
                    </div>
                  )}
                </div>
              )}
              <p className="text-base md:text-sm text-gray-400 mb-3">
                {t('addSecondMethod')}
              </p>
              <div className="space-y-1">
                {!hasTwitterLinked && (
                  <button
                    type="button"
                    onClick={async () => {
                      setShowSettingsModal(false);
                      setLinkingMethod("twitter");
                      try {
                        await linkTwitter();
                      } catch {
                        // Errors are surfaced via useLinkAccount onError.
                      }
                    }}
                    title="You'll be redirected to Twitter to login"
                    className="w-full text-left px-3 py-2.5 rounded-xl text-base md:text-sm font-medium transition-colors flex items-center gap-3 text-orange-400 hover:bg-orange-400/10"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    {t('addTwitter')}
                  </button>
                )}
                {!hasEmail && (
                  <button
                    type="button"
                    onClick={async () => {
                      setLinkingMethod("email");
                      try {
                        await linkEmail();
                      } catch {
                        // Errors are surfaced via useLinkAccount onError.
                      }
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-base md:text-sm font-medium transition-colors flex items-center gap-3 text-gray-300 hover:bg-white/10 hover:text-white"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    {t('addEmail')}
                  </button>
                )}
              </div>
              {canUpdateToTwitter && twitterHandle && (
                <div className="mt-3 p-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-base md:text-sm font-medium text-gray-300 mb-1">{t('paymentLink')}</p>
                  <p className="text-base md:text-sm text-gray-400 mb-2">
                    {t('useTwitterAsLink', { handle: twitterHandle })}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl bg-white/10 text-white border-0 hover:bg-white/20"
                    disabled={updatingToTwitter || !privyUser?.id}
                    onClick={async () => {
                      if (!privyUser?.id || !twitterHandle) return;
                      setUpdatingToTwitter(true);
                      try {
                        const res = await fetch("/api/users/setup-username", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ privyUserId: privyUser.id, username: twitterHandle }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          toast({ variant: "destructive", title: "Update failed", description: data.error || "Try again." });
                          return;
                        }
                        const newUsername = data.user?.username ?? twitterHandle;
                        setUsername(newUsername);
                        setAuth({ authenticated: true, email: storeEmail, username: newUsername });
                        toast({ title: "Payment link updated", description: `Your link is now @${newUsername}` });
                      } catch (e) {
                        toast({ variant: "destructive", title: "Update failed", description: "Try again." });
                      } finally {
                        setUpdatingToTwitter(false);
                      }
                    }}
                  >
                    {updatingToTwitter ? t('updating') : t('useHandle', { handle: twitterHandle })}
                  </Button>
                </div>
              )}
            </div>
            {walletAddress ? (
              <>
                <div>
                  <Label className="text-base md:text-sm font-medium mb-2 block text-gray-300">{t('walletAddress')}</Label>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10">
                    <p
                      className="flex-1 text-base md:text-sm font-mono break-all cursor-pointer text-white/90 hover:opacity-80"
                      onClick={() => {
                        setShowFullAddress(!showFullAddress);
                        if (!showFullAddress) copyToClipboard(walletAddress, false);
                      }}
                      title="Click to toggle full address"
                    >
                      {showFullAddress ? walletAddress : formatAddress(walletAddress)}
                    </p>
                    <button
                      onClick={() => copyToClipboard(walletAddress, false)}
                      className="p-2 rounded-lg hover:bg-white/10 shrink-0 text-gray-400 hover:text-white"
                      title={copied ? t('copied') : t('copyLink')}
                    >
                      {copied ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-base md:text-sm text-gray-500 mt-1">{showFullAddress ? t('clickToHide') : t('clickToCopy')}</p>
                </div>

                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setShowSettingsModal(false);
                      window.open(`https://solscan.io/account/${walletAddress}`, '_blank');
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-base md:text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    {t('viewOnSolscan')}
                  </button>
                  {/* Export Private Key button — temporarily hidden
                  <button
                    onClick={async () => {
                      setShowSettingsModal(false);
                      try {
                        if (!walletAddress) {
                          toast({
                            variant: "destructive",
                            title: "Wallet not found",
                            description: "Could not find your embedded wallet to export.",
                          });
                          return;
                        }
                        const result = await exportWallet({ address: walletAddress });
                        if (typeof result === 'string') {
                          setExportedPrivateKey(result);
                          setShowExportModal(true);
                        } else {
                          toast({
                            title: "Export initiated",
                            description: "Please follow the prompts to export your wallet private key.",
                          });
                        }
                      } catch (error: any) {
                        toast({
                          variant: "destructive",
                          title: "Export failed",
                          description: error?.message || "Failed to export wallet. Please try again.",
                        });
                      }
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-base md:text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    Export Private Key
                  </button>
                  */}
                </div>
              </>
            ) : (
              <div className="py-4 text-center">
                {!privyReady ? (
                  <p className="text-base md:text-sm text-gray-400">{t('loadingWallet')}</p>
                ) : (
                  <p className="text-base md:text-sm text-gray-400">{t('walletAutoCreated')}</p>
                )}
              </div>
            )}
                </div>
              </div>

              {/* Sticky close footer */}
              <div className="shrink-0 px-6 pb-8 sm:pb-5 pt-3 border-t border-white/10 bg-[#0f0f12]">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="w-full py-3.5 rounded-xl font-semibold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  {t('close')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Export Wallet Modal */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Private Key</DialogTitle>
            <DialogDescription>
              ⚠️ Keep your private key secure. Anyone with access to this key can control your wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {exportedPrivateKey ? (
              <>
                <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                  <Label className="text-base md:text-sm font-medium mb-2 block">Your Private Key:</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm md:text-xs font-mono break-all p-2 bg-white dark:bg-gray-800 rounded border">
                      {exportedPrivateKey}
                    </code>
                    <button
                      onClick={() => {
                        copyToClipboard(exportedPrivateKey, false);
                        toast({
                          title: "Copied!",
                          description: "Private key copied to clipboard.",
                        });
                      }}
                      className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-base md:text-sm text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> Never share this private key with anyone. Store it securely and never store it in plain text online.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-base md:text-sm text-gray-600 dark:text-gray-400">Loading private key...</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowExportModal(false);
                setExportedPrivateKey(null);
              }}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
