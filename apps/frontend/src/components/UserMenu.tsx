"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePrivy, useUser, useWallets, useLinkAccount, useUnlinkOAuth, useUnlinkEmail } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useAuthStore } from "@/store/auth";
import { getCachedMainnetAccess, setCachedMainnetAccess } from "@/lib/mainnetAccessCache";
import { TIERS, getTierForVolume } from "@/lib/tiers";
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
import { Settings, Loader2, AlertTriangle, X as XClose, Shield, Globe, Wallet } from "lucide-react";
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
  const nextTier = TIERS.find((t) => t.minVolume > volumeUsd);
  return (
    <div className={`mt-2 pt-2 pb-1 border-t ${dark ? "border-white/10" : "border-gray-200"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-sm font-medium ${dark ? "text-gray-400" : "text-gray-500"}`}>Status</span>
        <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${info.color} ${info.bg}`}>
          {info.label}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-sm ${dark ? "text-gray-500" : "text-gray-400"}`}>
          {formatVolume(volumeUsd)} sent &amp; received
        </span>
        {nextTier && (
          <span className={`text-sm ${dark ? "text-gray-600" : "text-gray-400"}`}>
            {formatVolume(nextTier.minVolume - volumeUsd)} to {nextTier.label}
          </span>
        )}
      </div>
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
  const storeLooUsername = useAuthStore((s) => s.looUsername ?? null);
  const storeTwitterUsername = useAuthStore((s) => s.twitterUsername ?? null);
  const usernameResolved = useAuthStore((s) => s.username !== undefined);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUsername = useAuthStore((s) => s.setUsername);
  const setLooUsername = useAuthStore((s) => s.setLooUsername);
  const setTwitterUsername = useAuthStore((s) => s.setTwitterUsername);

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
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateState, setRotateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rotateError, setRotateError] = useState("");
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [isLocalhost, setIsLocalhost] = useState(false);
  useEffect(() => {
    setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [updatingToTwitter, setUpdatingToTwitter] = useState(false);
  const [twitterLinkedOptimistic, setTwitterLinkedOptimistic] = useState(false);
  const [linkingMethod, setLinkingMethod] = useState<"twitter" | "email" | null>(null);
  const [unlinkingTwitter, setUnlinkingTwitter] = useState(false);
  const [confirmUnlinkTwitter, setConfirmUnlinkTwitter] = useState(false);
  const [unlinkingEmail, setUnlinkingEmail] = useState(false);
  const [switchingUsername, setSwitchingUsername] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ready: privyReady, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const { linkTwitter, linkEmail } = useLinkAccount({
    onSuccess: async (arg: any) => {
      const linkedType = arg?.linkedAccount?.type;
      const didLinkTwitter =
        linkedType === "twitter_oauth" ||
        linkedType === "twitter" ||
        linkedType === "x" ||
        arg?.linkMethod === "twitter" ||
        linkingMethod === "twitter";
      if (didLinkTwitter) {
        setTwitterLinkedOptimistic(true);
        // Persist Twitter handle to DB so the username toggle works
        const raw = arg?.linkedAccount?.username ?? arg?.linkedAccount?.name ?? "";
        const handle = String(raw).replace(/^@/, "").toLowerCase().trim();
        if (handle.length >= 1) {
          try {
            const token = await getAccessToken().catch(() => null);
            const res = await fetch("/api/users/save-twitter-username", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ twitterUsername: handle }),
            });
            if (res.ok) setTwitterUsername(handle);
          } catch { /* non-critical */ }
        }
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
  const unlinkOAuth = useUnlinkOAuth();
  const unlinkEmailHook = useUnlinkEmail();

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
  const canUpdateToTwitter = usernameResolved && hasTwitterLinked && twitterHandle && username?.toLowerCase() !== twitterHandle;
  const twitterAccount = useMemo(() =>
    linkedAccounts.find((a) => a.type && TWITTER_TYPES.includes(a.type as typeof TWITTER_TYPES[number])),
    [linkedAccounts]
  );
  const twitterSubject = (twitterAccount as { subject?: string } | undefined)?.subject ?? null;
  const totalMethods = [hasEmail, hasTwitterLinked].filter(Boolean).length;

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

  const handleUnlinkTwitter = async () => {
    if (!twitterSubject) return;
    setConfirmUnlinkTwitter(false);
    setUnlinkingTwitter(true);
    try {
      // If their active username is their Twitter handle, ensure a loo-username fallback exists first.
      // ABORT the entire unlink if this step fails — do not leave them without a payment link.
      const usernameIsTwitterHandle = username && twitterHandle && username.toLowerCase() === twitterHandle.toLowerCase();
      if (usernameIsTwitterHandle) {
        const suffix = (username ?? "").slice(0, 16);
        const looTarget = storeLooUsername ?? `loo-${suffix}`;
        if (!storeLooUsername) {
          // Create the loo-username — abort if it fails
          const token = await getAccessToken().catch(() => null);
          const res = await fetch("/api/users/setup-username", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ username: looTarget }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? "Could not create a backup username. Disconnection aborted.");
          }
          const data = await res.json();
          const saved = data.user?.username ?? looTarget;
          setUsername(saved);
          setLooUsername(data.user?.looUsername ?? saved);
          if (data.user?.twitterUsername) setTwitterUsername(data.user.twitterUsername);
          setAuth({ authenticated: true, email: storeEmail, username: saved, looUsername: data.user?.looUsername ?? saved });
        } else {
          // Switch active username to the already-saved loo-username
          const token = await getAccessToken().catch(() => null);
          const res = await fetch("/api/users/switch-username", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ use: "loo" }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? "Could not switch to backup username. Disconnection aborted.");
          }
          const data = await res.json();
          setUsername(data.username ?? storeLooUsername);
          setAuth({ authenticated: true, email: storeEmail, username: data.username ?? storeLooUsername });
        }
      }
      await unlinkOAuth.unlink({ provider: "twitter", subject: twitterSubject });
      setTwitterLinkedOptimistic(false);
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Twitter disconnected", description: "Your X account has been removed from sign-in methods." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingTwitter(false);
    }
  };

  const handleSwitchUsername = async (use: "loo" | "twitter") => {
    setSwitchingUsername(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/users/switch-username", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ use }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not switch username", description: data.error || "Try again." });
        return;
      }
      setUsername(data.username);
      if (data.looUsername !== undefined) setLooUsername(data.looUsername);
      if (data.twitterUsername !== undefined) setTwitterUsername(data.twitterUsername);
      setAuth({ authenticated: true, email: storeEmail, username: data.username });
      toast({ title: "Payment link updated", description: `Your link is now @${data.username}` });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not switch username", description: msg || "Try again." });
    } finally {
      setSwitchingUsername(false);
    }
  };

  const handleUnlinkEmail = async () => {
    if (!linkedEmailAddress) return;
    setUnlinkingEmail(true);
    try {
      await unlinkEmailHook.unlink({ address: linkedEmailAddress });
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Email disconnected", description: "Your email has been removed from sign-in methods." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingEmail(false);
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
                href="/sparks"
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

                {/* Rotate wallet confirmation view — replaces main content */}
                {showRotateConfirm ? (
                  <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
                    {rotateState === "done" ? (
                      <>
                        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-5">
                          <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <p className="text-white font-semibold text-lg mb-1">New wallet ready</p>
                        {newWalletAddress && (
                          <p className="text-slate-400 text-sm mb-3 font-mono">{newWalletAddress.slice(0, 8)}…{newWalletAddress.slice(-6)}</p>
                        )}
                        <p className="text-slate-400 text-sm mb-6">Your new wallet is now active. The previous address is no longer used by Loofta.</p>
                        <button
                          type="button"
                          onClick={() => { setShowRotateConfirm(false); setRotateState("idle"); setNewWalletAddress(""); }}
                          className="w-full py-3 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                        >
                          Done
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-full bg-white/8 flex items-center justify-center mb-5">
                          <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </div>
                        <p className="text-white font-semibold text-lg mb-2">Generate new wallet?</p>
                        <p className="text-slate-400 text-sm mb-1">A new Solana wallet will be created and used for all future payments on Loofta.</p>
                        <p className="text-slate-500 text-sm mb-6">Your previous wallet stays in Privy but won&apos;t be used by Loofta anymore.</p>
                        {rotateState === "error" && (
                          <p className="text-red-400 text-sm mb-3">{rotateError}</p>
                        )}
                        <div className="flex gap-3 w-full">
                          <button
                            type="button"
                            disabled={rotateState === "loading"}
                            onClick={() => { setShowRotateConfirm(false); setRotateState("idle"); setRotateError(""); }}
                            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={rotateState === "loading"}
                            onClick={async () => {
                              setRotateState("loading");
                              setRotateError("");
                              try {
                                if (!privyUser?.id) throw new Error("Not authenticated");
                                // Best-effort: archive the current wallet.
                                // Fails silently if there's no wallet to archive.
                                const token = await getAccessToken().catch(() => null);
                                const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
                                if (walletAddress) {
                                  await fetch("/api/users/archive-wallet", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", ...authHeader },
                                    body: JSON.stringify({ walletAddress }),
                                  }).catch(() => { /* ignore */ });
                                }
                                // Create new wallet server-side (bypasses Privy's one-wallet-per-user
                                // client limit which counts archived wallets).
                                const createRes = await fetch("/api/users/create-solana-wallet", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", ...authHeader },
                                });
                                if (!createRes.ok) {
                                  const body = await createRes.json().catch(() => ({}));
                                  throw new Error(body?.error ?? "Failed to create wallet");
                                }
                                const { address } = await createRes.json();
                                setNewWalletAddress(address ?? "");
                                await refreshUser();
                                setRotateState("done");
                              } catch (e: any) {
                                setRotateError(e?.message ?? "Failed to create wallet");
                                setRotateState("error");
                              }
                            }}
                            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            {rotateState === "loading" ? (
                              <span className="flex items-center justify-center gap-2">
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                Creating…
                              </span>
                            ) : "Generate"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Hero header */}
                    <div className="text-center mb-6 pt-1">
                      <div className="mb-4 flex justify-center">
                        <div className="relative">
                          <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center"
                            style={{
                              background: "linear-gradient(135deg, rgba(255,74,38,0.18) 0%, rgba(225,160,65,0.18) 100%)",
                              border: "1px solid rgba(255,122,42,0.25)",
                              boxShadow: "0 0 32px rgba(255,122,42,0.12)",
                            }}
                          >
                            <Settings className="w-7 h-7 text-orange-400" />
                          </div>
                          <div
                            className="absolute inset-0 rounded-2xl blur-2xl opacity-20 -z-10"
                            style={{ background: "linear-gradient(135deg, #FF4A26, #E1A041)" }}
                          />
                        </div>
                      </div>
                      <h2 className="text-xl font-bold text-white mb-1">{t('settingsTitle')}</h2>
                      <p className="text-sm text-slate-500">{t('settingsSubtitle')}</p>
                    </div>

                    <div className="space-y-3">

                      {/* Sign-in methods card */}
                      <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
                          <div className="w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                            <Shield className="w-3.5 h-3.5 text-slate-300" />
                          </div>
                          <span className="text-sm font-semibold text-white">{t('signInMethods')}</span>
                        </div>

                        <div className="px-4 pt-3 pb-4 space-y-2.5">
                          {/* Connected accounts */}
                          {(hasEmail || hasTwitterLinked) && (
                            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
                              <div className="divide-y divide-white/[0.05]">
                                {hasEmail && linkedEmailAddress && (
                                  <div className="flex items-center gap-3 px-3 py-2.5">
                                    <div className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                        <polyline points="22,6 12,13 2,6" />
                                      </svg>
                                    </div>
                                    <span className="flex-1 text-sm text-white/80 truncate">{linkedEmailAddress}</span>
                                    {totalMethods > 1 ? (
                                      <button
                                        type="button"
                                        onClick={handleUnlinkEmail}
                                        disabled={unlinkingEmail}
                                        className="shrink-0 px-2 py-1 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/8 transition-colors disabled:opacity-40"
                                      >
                                        {unlinkingEmail ? <Loader2 className="w-3 h-3 animate-spin" /> : "Remove"}
                                      </button>
                                    ) : (
                                      <span className="shrink-0 px-2 py-0.5 rounded-full text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Active</span>
                                    )}
                                  </div>
                                )}
                                {hasTwitterLinked && twitterHandle && (
                                  <div className="flex flex-col gap-0 px-3 py-2.5">
                                    <div className="flex items-center gap-3">
                                      <div className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400">
                                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                      </div>
                                      <span className="flex-1 text-sm text-white/80">@{twitterHandle}</span>
                                      {totalMethods > 1 ? (
                                        confirmUnlinkTwitter ? (
                                          <div className="flex items-center gap-1 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => setConfirmUnlinkTwitter(false)}
                                              className="px-2 py-1 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/8 transition-colors"
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              type="button"
                                              onClick={handleUnlinkTwitter}
                                              disabled={unlinkingTwitter}
                                              className="px-2 py-1 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                            >
                                              {unlinkingTwitter ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, remove"}
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => setConfirmUnlinkTwitter(true)}
                                            disabled={unlinkingTwitter}
                                            className="shrink-0 px-2 py-1 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/8 transition-colors disabled:opacity-40"
                                          >
                                            Remove
                                          </button>
                                        )
                                      ) : (
                                        <span className="shrink-0 px-2 py-0.5 rounded-full text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Active</span>
                                      )}
                                    </div>
                                    {confirmUnlinkTwitter && (
                                      <div className="mt-2 ml-10 px-3 py-2 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                                        <p className="text-sm text-amber-300/90 leading-snug">
                                          {username?.toLowerCase() === twitterHandle.toLowerCase()
                                            ? `Your payment link will switch to @${storeLooUsername ?? `loo-${username?.slice(0, 16)}`}.`
                                            : "Your payment link username stays the same."}
                                          {" "}Are you sure?
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Recovery warning */}
                          {totalMethods < 2 && (
                            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                              <p className="text-sm text-amber-300/90 leading-snug">{t('addSecondMethod')}</p>
                            </div>
                          )}

                          {/* Add methods */}
                          <div className="space-y-1.5">
                            {!hasTwitterLinked && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setShowSettingsModal(false);
                                  setLinkingMethod("twitter");
                                  try { await linkTwitter(); } catch { /* surfaced via onError */ }
                                }}
                                title="You'll be redirected to Twitter to log in"
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors border border-white/[0.05]"
                              >
                                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-slate-500">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                  </svg>
                                </div>
                                <span className="flex-1 text-left">{t('addTwitter')}</span>
                                <span className="text-slate-600 text-base leading-none">+</span>
                              </button>
                            )}
                            {!hasEmail && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setLinkingMethod("email");
                                  try { await linkEmail(); } catch { /* surfaced via onError */ }
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors border border-white/[0.05]"
                              >
                                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                  </svg>
                                </div>
                                <span className="flex-1 text-left">{t('addEmail')}</span>
                                <span className="text-slate-600 text-base leading-none">+</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Payment link username toggle */}
                      {(storeLooUsername || storeTwitterUsername) ? (
                        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                          <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
                            <div className="w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                              </svg>
                            </div>
                            <span className="text-sm font-semibold text-white">Payment link</span>
                          </div>
                          <div className="px-4 pt-3 pb-4 space-y-2">
                            <p className="text-sm text-slate-500">Choose which username your payment link uses.</p>
                            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.05]">
                              {storeLooUsername && (
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                  <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                    <span className="text-sm font-bold text-slate-400 leading-none">L</span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white/80 truncate">@{storeLooUsername}</p>
                                    <p className="text-sm text-slate-600">Your Loofta username</p>
                                  </div>
                                  {username === storeLooUsername ? (
                                    <span className="shrink-0 px-2 py-0.5 rounded-full text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Active</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSwitchUsername("loo")}
                                      disabled={switchingUsername}
                                      className="shrink-0 px-3 py-1 rounded-lg text-sm text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40"
                                    >
                                      {switchingUsername ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Use"}
                                    </button>
                                  )}
                                </div>
                              )}
                              {storeTwitterUsername && (
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                  <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400">
                                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                    </svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white/80 truncate">@{storeTwitterUsername}</p>
                                    <p className="text-sm text-slate-600">Your X username</p>
                                  </div>
                                  {username === storeTwitterUsername ? (
                                    <span className="shrink-0 px-2 py-0.5 rounded-full text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Active</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleSwitchUsername("twitter")}
                                      disabled={switchingUsername || !hasTwitterLinked}
                                      className="shrink-0 px-3 py-1 rounded-lg text-sm text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40"
                                      title={!hasTwitterLinked ? "Re-link X to use this username" : undefined}
                                    >
                                      {switchingUsername ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Use"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : canUpdateToTwitter && twitterHandle ? (
                        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-3.5">
                          <p className="text-sm font-semibold text-white mb-1">{t('paymentLink')}</p>
                          <p className="text-sm text-slate-500 mb-3">{t('useTwitterAsLink', { handle: twitterHandle })}</p>
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-xl bg-gradient-to-r from-[#FF4A26] to-[#E1A041] text-white border-0 hover:opacity-90 text-sm font-medium"
                            disabled={updatingToTwitter || !privyUser?.id}
                            onClick={async () => {
                              if (!privyUser?.id || !twitterHandle) return;
                              setUpdatingToTwitter(true);
                              try {
                                const token = await getAccessToken().catch(() => null);
                                const res = await fetch("/api/users/setup-username", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                  },
                                  body: JSON.stringify({ username: twitterHandle }),
                                });
                                const data = await res.json();
                                if (!res.ok) {
                                  toast({ variant: "destructive", title: "Update failed", description: data.error || "Try again." });
                                  return;
                                }
                                const newUsername = data.user?.username ?? twitterHandle;
                                setUsername(newUsername);
                                if (data.user?.looUsername) setLooUsername(data.user.looUsername);
                                if (data.user?.twitterUsername) setTwitterUsername(data.user.twitterUsername);
                                setAuth({ authenticated: true, email: storeEmail, username: newUsername, looUsername: data.user?.looUsername, twitterUsername: data.user?.twitterUsername });
                                toast({ title: "Payment link updated", description: `Your link is now @${newUsername}` });
                              } catch {
                                toast({ variant: "destructive", title: "Update failed", description: "Try again." });
                              } finally {
                                setUpdatingToTwitter(false);
                              }
                            }}
                          >
                            {updatingToTwitter ? t('updating') : t('useHandle', { handle: twitterHandle })}
                          </Button>
                        </div>
                      ) : null}

                      {/* Network toggle card */}
                      <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
                          <div className="w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                            <Globe className="w-3.5 h-3.5 text-slate-300" />
                          </div>
                          <span className="text-sm font-semibold text-white">{t('network')}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3.5">
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm text-white/80">
                              {networkMode === "mainnet"
                                ? (mainnetAccess ? t('mainnetBeta') : t('mainnetViewOnly'))
                                : t('devnet')}
                            </span>
                            {networkMode === "mainnet" && !mainnetAccess && (
                              <span className="text-sm text-amber-400/80 mt-0.5">{t('balanceWithdrawOnly')}</span>
                            )}
                          </div>
                          <Switch
                            checked={networkMode === "mainnet"}
                            onCheckedChange={(checked) => setNetworkMode(checked ? "mainnet" : "devnet")}
                          />
                        </div>
                      </div>

                      {/* Wallet card */}
                      {walletAddress ? (
                        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                          <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
                            <div className="w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                              <Wallet className="w-3.5 h-3.5 text-slate-300" />
                            </div>
                            <span className="text-sm font-semibold text-white">{t('walletAddress')}</span>
                          </div>
                          <div className="px-4 pt-3 pb-4 space-y-2">
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                              <p
                                className="flex-1 text-sm font-mono break-all cursor-pointer text-white/70 hover:text-white/90 transition-colors"
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
                                className="p-1.5 rounded-lg hover:bg-white/10 shrink-0 text-slate-500 hover:text-white transition-colors"
                                title={copied ? t('copied') : t('copyLink')}
                              >
                                {copied ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                )}
                              </button>
                            </div>
                            <p className="text-sm text-slate-500">{showFullAddress ? t('clickToHide') : t('clickToCopy')}</p>

                            <button
                              onClick={() => {
                                setShowSettingsModal(false);
                                window.open(`https://solscan.io/account/${walletAddress}`, '_blank');
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                              {t('viewOnSolscan')}
                            </button>

                            {walletAddress && isLocalhost && (
                              <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
                                <div>
                                  <p className="text-sm text-slate-400">New wallet address</p>
                                  {balanceUSD >= 0.1 && (
                                    <p className="text-sm text-amber-400/80 mt-0.5">Withdraw below $0.10 first</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  disabled={balanceUSD >= 0.1}
                                  onClick={() => setShowRotateConfirm(true)}
                                  className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/10 hover:bg-white/15 text-white"
                                >
                                  Generate new
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-5 text-center">
                          {!privyReady ? (
                            <p className="text-sm text-slate-500">{t('loadingWallet')}</p>
                          ) : (
                            <p className="text-sm text-slate-500">{t('walletAutoCreated')}</p>
                          )}
                        </div>
                      )}

                    </div>
                  </>
                )}
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
