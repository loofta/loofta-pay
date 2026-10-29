"use client";

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePrivy, useUser, useWallets, useLinkAccount, useUnlinkOAuth, useUnlinkEmail, useUnlinkTelegram } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useAuthStore } from "@/store/auth";
import { TIERS, getTierForVolume } from "@/lib/tiers";
import { useToast } from "@/components/ui/use-toast";
import { Wallet as WalletIcon, Settings, Loader2, AlertTriangle, X as XClose, Shield, Info, KeyRound, Copy, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { clientApiBase } from "@/services/api/client";
import { ChangeUsernameModal } from "@/components/ChangeUsernameModal";
import { UserAvatar } from "@/components/UserAvatar";
/** Privy uses type "twitter_oauth" for Twitter (not "twitter" or "x"). */
const TWITTER_TYPES = ["twitter_oauth", "twitter", "x"] as const;
/** Exact Privy type strings for Discord/GitHub aren't publicly pinned down — check known variants defensively, same as Twitter above. */
const DISCORD_TYPES = ["discord_oauth", "discord"] as const;
const GITHUB_TYPES = ["github_oauth", "github"] as const;

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

/** Handle for a given set of linked-account type strings (username || name || subject) — used for Discord/GitHub. */
function getSocialUsername(
  linkedAccounts: Array<{ type?: string; username?: string; name?: string; subject?: string }> | undefined,
  types: readonly string[],
): string | null {
  const acc = (linkedAccounts || []).find((a) => a.type && types.includes(a.type));
  if (!acc) return null;
  const raw = (acc as { username?: string; name?: string; subject?: string }).username
    || (acc as { name?: string }).name
    || (acc as { subject?: string }).subject
    || "";
  const s = String(raw).replace(/^@/, "").toLowerCase().trim();
  return s.length >= 1 ? s : null;
}

function SettingsRadio({ selected }: { selected: boolean }) {
  return (
    <span
      className={`shrink-0 h-[18px] w-[18px] rounded-full border-2 flex items-center justify-center ${selected ? "border-white" : "border-white/30"}`}
      aria-hidden
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
    </span>
  );
}

const settingsPillClass =
  "shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full border border-white/15 text-sm font-medium text-slate-200 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

const settingsRemoveClass =
  "shrink-0 text-sm font-medium text-slate-400 hover:text-white transition-colors disabled:opacity-40";

const settingsSectionLabelClass =
  "mb-2.5 text-sm font-medium uppercase tracking-[0.14em] text-slate-500";

function SettingsIconTile({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${className}`}>
      {children}
    </div>
  );
}

function SettingsAccountRow({
  icon,
  title,
  subtitle,
  action,
  note,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-3.5 py-3">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-white truncate">{title}</p>
          <p className="text-sm text-slate-500 leading-snug">{subtitle}</p>
        </div>
        {action}
      </div>
      {note}
    </div>
  );
}

function formatVolume(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

function TierBadge({ volumeUsd, dark }: { volumeUsd: number; dark: boolean }) {
  const [showTiers, setShowTiers] = useState(false);
  const info = getTierForVolume(volumeUsd);
  const nextTier = TIERS.find((t) => t.minVolume > volumeUsd);
  return (
    <div className={`mt-2 pt-2 pb-1 border-t ${dark ? "border-white/10" : "border-gray-200"}`}>
      {/* Status row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-medium ${dark ? "text-gray-400" : "text-gray-500"}`}>Status</span>
          <button
            type="button"
            onClick={() => setShowTiers(v => !v)}
            className={`rounded-full p-0.5 transition-colors ${dark ? "text-gray-600 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}
            title="About tiers"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
        <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${info.color} ${info.bg}`}>
          {info.label}
        </span>
      </div>

      {/* Volume stats */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className={`text-sm font-semibold ${dark ? "text-gray-100" : "text-gray-800"}`}>
            {formatVolume(volumeUsd)}
          </span>
          <span className={`text-sm ${dark ? "text-gray-500" : "text-gray-400"}`}>sent &amp; received</span>
        </div>
        {nextTier && (
          <div className="flex flex-col items-end">
            <span className={`text-sm font-semibold ${dark ? "text-gray-100" : "text-gray-800"}`}>
              {formatVolume(nextTier.minVolume - volumeUsd)}
            </span>
            <span className={`text-sm ${dark ? "text-gray-500" : "text-gray-400"}`}>to {nextTier.label}</span>
          </div>
        )}
      </div>

      {/* Tier info panel */}
      {showTiers && (
        <div className={`mt-3 rounded-xl border p-3 ${dark ? "bg-white/[0.04] border-white/[0.07]" : "bg-gray-50 border-gray-200"}`}>
          <p className={`text-sm font-semibold uppercase tracking-widest mb-2 ${dark ? "text-gray-500" : "text-gray-400"}`}>All tiers</p>
          <div className="space-y-1">
            {TIERS.map((t) => (
              <div
                key={t.key}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${info.key === t.key ? (dark ? "bg-white/[0.07]" : "bg-white shadow-sm") : ""}`}
              >
                <span className={`text-sm font-medium ${t.color}`}>{t.label}</span>
                <span className={`text-sm tabular-nums ${dark ? "text-gray-500" : "text-gray-400"}`}>
                  {t.maxVolume
                    ? `$${t.minVolume.toLocaleString()} – $${t.maxVolume.toLocaleString()}`
                    : `$${t.minVolume.toLocaleString()}+`}
                </span>
              </div>
            ))}
          </div>
        </div>
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
  const storeLooUsername = useAuthStore((s) => s.looUsername ?? null);
  const storeTwitterUsername = useAuthStore((s) => s.twitterUsername ?? null);
  const storeAvatarUrl = useAuthStore((s) => s.avatarUrl ?? null);
  const setAvatarUrl = useAuthStore((s) => s.setAvatarUrl);
  const usernameResolved = useAuthStore((s) => s.username !== undefined);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUsername = useAuthStore((s) => s.setUsername);
  const setLooUsername = useAuthStore((s) => s.setLooUsername);
  const setTwitterUsername = useAuthStore((s) => s.setTwitterUsername);

  // Use props if available, otherwise fallback to store
  const username = usernameProp ?? storeUsername;
  const email = emailProp ?? storeEmail;

  const setMainnetAccess = useAuthStore((s) => s.setMainnetAccess);
  const tier = useAuthStore((s) => s.tier);
  const totalVolumeUsd = useAuthStore((s) => s.totalVolumeUsd);
  const setTier = useAuthStore((s) => s.setTier);

  const openShareModalFromStore = useAuthStore((s) => s.openShareModal);
  const setOpenShareModal = useAuthStore((s) => s.setOpenShareModal);
  const openSettingsModalFromStore = useAuthStore((s) => s.openSettingsModal);
  const setOpenSettingsModal = useAuthStore((s) => s.setOpenSettingsModal);
  const setIsOnboardingOpen = useAuthStore((s) => s.setIsOnboardingOpen);

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
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [exportingWallet, setExportingWallet] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [requirePrivatePayments, setRequirePrivatePayments] = useState(false);
  const [savingPrivatePayments, setSavingPrivatePayments] = useState(false);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateState, setRotateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rotateError, setRotateError] = useState("");
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [updatingToTwitter, setUpdatingToTwitter] = useState(false);
  const [twitterLinkedOptimistic, setTwitterLinkedOptimistic] = useState(false);
  const [linkingMethod, setLinkingMethod] = useState<"twitter" | "email" | "discord" | "github" | null>(null);
  const [unlinkingTwitter, setUnlinkingTwitter] = useState(false);
  const [confirmUnlinkTwitter, setConfirmUnlinkTwitter] = useState(false);
  const [unlinkingEmail, setUnlinkingEmail] = useState(false);
  const [discordLinkedOptimistic, setDiscordLinkedOptimistic] = useState(false);
  const [githubLinkedOptimistic, setGithubLinkedOptimistic] = useState(false);
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);
  const [unlinkingGithub, setUnlinkingGithub] = useState(false);
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);
  const [telegramHandle, setTelegramHandle] = useState<string | null>(null);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [switchingUsername, setSwitchingUsername] = useState(false);
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ready: privyReady, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { refreshUser } = useUser();
  const queryClient = useQueryClient();
  const { linkTwitter, linkEmail, linkDiscord, linkGithub, linkOAuth } = useLinkAccount({
    onSuccess: async (arg: any) => {
      const linkedType = arg?.linkedAccount?.type;
      const didLinkTwitter =
        linkedType === "twitter_oauth" ||
        linkedType === "twitter" ||
        linkedType === "x" ||
        arg?.linkMethod === "twitter" ||
        linkingMethod === "twitter";
      const didLinkDiscord = DISCORD_TYPES.includes(linkedType) || linkingMethod === "discord";
      const didLinkGithub = GITHUB_TYPES.includes(linkedType) || linkingMethod === "github";
      const didLinkTelegram = linkedType === "telegram" || linkedType === "telegram_oauth";
      if (didLinkTelegram) {
        const handle = String(arg?.linkedAccount?.username ?? "").replace(/^@/, "").toLowerCase().trim();
        if (handle) {
          try {
            const token = await getAccessToken().catch(() => null);
            const res = await fetch("/api/users/save-social-handle", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ platform: "telegram", handle }),
            });
            if (res.ok) setTelegramHandle(handle);
            else {
              const data = await res.json().catch(() => null);
              toast({ variant: "destructive", title: "Could not connect Telegram", description: data?.error || "Try again." });
            }
          } catch { /* non-critical */ }
        }
        setConnectingTelegram(false);
      }
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
            if (res.ok) {
              const saved = await res.json().catch(() => ({}));
              setTwitterUsername(saved.twitterUsername ?? handle);
              if (saved.avatarUrl) setAvatarUrl(saved.avatarUrl);
            }
          } catch { /* non-critical */ }
        }
      }
      if (didLinkDiscord || didLinkGithub) {
        const platform = didLinkDiscord ? "discord" : "github";
        if (didLinkDiscord) setDiscordLinkedOptimistic(true);
        else setGithubLinkedOptimistic(true);
        const raw = arg?.linkedAccount?.username ?? arg?.linkedAccount?.name ?? "";
        const handle = String(raw).replace(/^@/, "").toLowerCase().trim();
        if (handle.length >= 1) {
          try {
            const token = await getAccessToken().catch(() => null);
            await fetch("/api/users/save-social-handle", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ platform, handle }),
            });
          } catch { /* non-critical */ }
        }
      }
      setLinkingMethod(null);
      // Force Privy to re-fetch the user so linkedAccounts is immediately up to date.
      try { await refreshUser(); } catch { /* non-critical */ }
      // A newly-linked email/X handle may match a payment sent to us before we linked it —
      // re-run the unclaimed-payments check now instead of waiting out its 5 min staleTime.
      queryClient.invalidateQueries({ queryKey: ["payments", "unclaimed-nudge"] });
      toast({ title: "Account linked", description: "Sign-in method added successfully." });
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
      setLinkingMethod(null);
      if (/already been linked|already linked|linked to another user/i.test(msg)) {
        const isTwitterConflict = linkingMethod === "twitter" || /twitter|x|oauth/i.test(msg);
        const isSocialConflict = linkingMethod === "discord" || linkingMethod === "github";
        const socialLabel = linkingMethod === "discord" ? "Discord" : "GitHub";
        toast({
          variant: "destructive",
          title: isTwitterConflict ? "X account already in use" : isSocialConflict ? "Account already in use" : "Email already in use",
          description: isTwitterConflict
            ? "This X account is already linked to another user. Use another X account or sign in to the existing account."
            : isSocialConflict
              ? `This ${socialLabel} account is already linked to another user.`
              : "This email is linked to another account. Sign in with that email to use it.",
        });
      } else {
        toast({ variant: "destructive", title: "Could not link", description: msg || "Try again." });
      }
    },
  });
  const { exportWallet } = useExportWallet();
  const unlinkOAuth = useUnlinkOAuth();
  const unlinkTelegramAccount = useUnlinkTelegram();
  const unlinkEmailHook = useUnlinkEmail();

  const { wallets } = useWallets();
  const { toast } = useToast();
  const { balanceUSD } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated === true });

  const handleExportWallet = async () => {
    if (!walletAddress) {
      toast({ variant: "destructive", title: t('exportWalletUnavailable') });
      return;
    }
    setExportingWallet(true);
    try {
      await exportWallet({ address: walletAddress });
    } catch {
      // User closed Privy's export modal or export failed — nothing to surface.
    } finally {
      setExportingWallet(false);
    }
  };

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
  const twitterPicture = (twitterAccount as { profilePictureUrl?: string | null } | undefined)?.profilePictureUrl?.trim() || null;
  const headerAvatarUrl = twitterPicture || storeAvatarUrl;
  const totalMethods = [hasEmail, hasTwitterLinked].filter(Boolean).length;

  // Discord/GitHub: connect-for-pay-by-handle, not counted toward the sign-in recovery total —
  // they're a separate "Connect accounts" concern from the email/Twitter sign-in methods card.
  const hasDiscordLinked = linkedAccounts.some((a) => a.type && DISCORD_TYPES.includes(a.type as any)) || discordLinkedOptimistic;
  const hasGithubLinked = linkedAccounts.some((a) => a.type && GITHUB_TYPES.includes(a.type as any)) || githubLinkedOptimistic;
  const discordHandle = useMemo(() => getSocialUsername(linkedAccounts, DISCORD_TYPES), [linkedAccounts]);
  const githubHandle = useMemo(() => getSocialUsername(linkedAccounts, GITHUB_TYPES), [linkedAccounts]);
  // Telegram is a Privy-linked account like the other socials. Accounts connected through the old
  // loofta.com relay only have the social_accounts row (telegramHandle), so fall back to that.
  const privyTelegram = useMemo(
    () => linkedAccounts.find((a) => a.type === "telegram" || a.type === "telegram_oauth") as
      | { username?: string | null; telegramUserId?: string }
      | undefined,
    [linkedAccounts],
  );
  const telegramDisplayHandle = privyTelegram?.username?.replace(/^@/, "").toLowerCase() || telegramHandle;
  const hasTelegramLinked = !!privyTelegram || !!telegramHandle;
  const discordSubject = useMemo(() =>
    (linkedAccounts.find((a) => a.type && DISCORD_TYPES.includes(a.type as any)) as { subject?: string } | undefined)?.subject ?? null,
    [linkedAccounts]
  );
  const githubSubject = useMemo(() =>
    (linkedAccounts.find((a) => a.type && GITHUB_TYPES.includes(a.type as any)) as { subject?: string } | undefined)?.subject ?? null,
    [linkedAccounts]
  );

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
      : process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.com";
    return `${baseUrl}/me/@${username}`;
  };


  // Telegram isn't a Privy-linked account in this app (see telegram-relay/) — fetch its
  // connected state from social_accounts whenever the settings modal opens.
  const fetchTelegramHandle = async () => {
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/users/social-handles", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setTelegramHandle(data?.handles?.telegram ?? null);
      }
    } catch { /* non-critical */ }
  };
  useEffect(() => {
    if (showSettingsModal && authenticated) {
      const backendUrl = clientApiBase();
      getAccessToken().then(async (token) => {
        if (!token) return;
        const r = await fetch(`${backendUrl}/users/me/private-payments`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const body = (await r.json()) as { requirePrivatePayments?: boolean };
        setRequirePrivatePayments(!!body.requirePrivatePayments);
      }).catch(() => {});
      fetchTelegramHandle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettingsModal, authenticated]);

  // After returning from the loofta.com Telegram relay, show a toast, refetch, and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") !== "telegram") return;
    const errorCode = params.get("error");
    if (errorCode) {
      toast({ variant: "destructive", title: "Could not connect Telegram", description: "Please try again." });
    } else {
      toast({ title: "Telegram connected", description: "Your Telegram handle has been added." });
      fetchTelegramHandle();
    }
    params.delete("connected");
    params.delete("error");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Privy's linkTelegram only supports the HMAC bot flow; this app uses Telegram OIDC, so link it
  // through the generic OAuth link (same flow and onSuccess as X / Discord / GitHub).
  const handleConnectTelegram = async () => {
    try {
      await linkOAuth({ provider: "telegram" });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not connect Telegram", description: msg || "Try again." });
    }
  };

  // Mainnet is open to everyone — always grant access on login.
  useEffect(() => {
    if (authenticated) setMainnetAccess(true);
  }, [authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user tier (volume-based status) on mount
  useEffect(() => {
    if (!authenticated || !getAccessToken || !privyUser?.id) return;
    const fetchTier = async () => {
      try {
        const backendUrl = clientApiBase();
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
      // Always land on the loo-username after disconnecting X — not just when the active
      // username happens to exactly match the raw Twitter handle (usernames can drift from
      // that, e.g. a collision suffix at signup), so this used to silently skip the switch.
      // ABORT the entire unlink if this step fails — do not leave them without a payment link.
      const alreadyOnLooUsername = !!storeLooUsername && (username ?? "").toLowerCase() === storeLooUsername.toLowerCase();
      if (!alreadyOnLooUsername) {
        const suffix = (username ?? twitterHandle ?? "user").slice(0, 16);
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
      setTwitterUsername(null);
      setAvatarUrl(null);
      try {
        const clearToken = await getAccessToken().catch(() => null);
        await fetch("/api/users/save-twitter-username", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(clearToken ? { Authorization: `Bearer ${clearToken}` } : {}) },
          body: JSON.stringify({ twitterUsername: null }),
        });
      } catch { /* non-critical — stale DB value just won't display anywhere important */ }
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Twitter disconnected", description: "Your X account has been removed from sign-in methods." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingTwitter(false);
    }
  };

  const handleUnlinkDiscord = async () => {
    if (!discordSubject) return;
    setUnlinkingDiscord(true);
    try {
      await unlinkOAuth.unlink({ provider: "discord", subject: discordSubject });
      setDiscordLinkedOptimistic(false);
      try {
        const token = await getAccessToken().catch(() => null);
        await fetch("/api/users/save-social-handle", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ platform: "discord", handle: null }),
        });
      } catch { /* non-critical — stale row just won't display anywhere important */ }
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Discord disconnected", description: "Your Discord account has been removed." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingDiscord(false);
    }
  };

  const handleUnlinkGithub = async () => {
    if (!githubSubject) return;
    setUnlinkingGithub(true);
    try {
      await unlinkOAuth.unlink({ provider: "github", subject: githubSubject });
      setGithubLinkedOptimistic(false);
      try {
        const token = await getAccessToken().catch(() => null);
        await fetch("/api/users/save-social-handle", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ platform: "github", handle: null }),
        });
      } catch { /* non-critical — stale row just won't display anywhere important */ }
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "GitHub disconnected", description: "Your GitHub account has been removed." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingGithub(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    setUnlinkingTelegram(true);
    try {
      if (privyTelegram?.telegramUserId) {
        await unlinkTelegramAccount.unlink({ telegramUserId: privyTelegram.telegramUserId });
      }
      try {
        const token = await getAccessToken().catch(() => null);
        await fetch("/api/users/save-social-handle", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ platform: "telegram", handle: null }),
        });
      } catch { /* non-critical — stale row just won't display anywhere important */ }
      setTelegramHandle(null);
      try { await refreshUser(); } catch { /* non-critical */ }
      toast({ title: "Telegram disconnected", description: "Your Telegram account has been removed." });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      toast({ variant: "destructive", title: "Could not disconnect", description: msg || "Try again." });
    } finally {
      setUnlinkingTelegram(false);
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
      // Reload instead of patching the store in place — guarantees every page (header, claim
      // pages, etc.) reflects the new username at once instead of each catching up on its own.
      window.location.reload();
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

  const paymentLink = getPaymentLink();
  const paymentLinkLabel = paymentLink?.replace(/^https?:\/\//, "") ?? null;
  const looActive = !!storeLooUsername && username === storeLooUsername;
  const xActive = !!storeTwitterUsername && hasTwitterLinked && username === storeTwitterUsername;
  const walletRotateBlocked = balanceUSD >= 0.1;

  const menuLabel = username || email || "";
  const menuInitial = (menuLabel.replace(/^@/, "").trim().charAt(0) || "?").toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      {/* Username Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`hidden sm:flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isDarkPage
          ? "text-white hover:bg-white/[0.06] focus-visible:ring-white/30 focus-visible:ring-offset-[#0B0B0E]"
          : "text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400 focus-visible:ring-offset-white"
          }`}
      >
        <UserAvatar label={menuLabel || menuInitial} avatarUrl={headerAvatarUrl} className="h-8 w-8 text-sm" />
        <span className="max-w-[140px] truncate text-sm font-medium">{menuLabel}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[#8E8C96] transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-2xl border z-50 ${isDarkPage
            ? "bg-[#0d0d14]/90 backdrop-blur-2xl border-white/[0.08]"
            : "bg-white border-gray-200"
            }`}
        >
          <div className="p-2">
            {/* User Info Section */}
            <div className={`px-3 py-2 rounded-lg mb-1 ${isDarkPage ? "bg-white/[0.05]" : "bg-gray-50"
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
            <div className={`h-px my-2 ${isDarkPage ? "bg-white/[0.07]" : "bg-gray-200"
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



{/* Settings - opens modal with wallet address & export private keys */}
            <div className="mb-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  setShowSettingsModal(true);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors flex items-center gap-2 ${isDarkPage
                  ? "text-gray-300 hover:bg-white/[0.07]"
                  : "text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                {t('settings')}
              </button>
            </div>

{/* Wallet - tokens, send, receive, swap and history */}
            <div className="mb-1">
              <Link
                href="/app/portfolio"
                onClick={() => setIsOpen(false)}
                className={`w-full text-left px-3 py-2 rounded-lg text-base md:text-sm transition-colors flex items-center gap-2 ${isDarkPage
                  ? "text-gray-300 hover:bg-white/[0.07]"
                  : "text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <WalletIcon className="w-4 h-4 shrink-0" />
                Wallet
              </Link>
            </div>

            {/* Divider */}
            {username && (
              <div className={`h-px my-2 ${isDarkPage ? "bg-white/[0.07]" : "bg-gray-200"
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
              className="bg-[#141418] sm:border sm:border-white/10 sm:rounded-[28px] w-full sm:max-w-lg shadow-2xl flex flex-col h-full sm:h-auto sm:max-h-[90vh] overflow-hidden text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-2">
                <h2 className="text-xl font-bold tracking-tight text-white">{t('settingsTitle')}</h2>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors border border-white/10 bg-white/[0.04]"
                  aria-label={t('close')}
                >
                  <XClose className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6">

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
                          <p className="text-slate-400 text-base mb-3 font-mono">{newWalletAddress.slice(0, 8)}…{newWalletAddress.slice(-6)}</p>
                        )}
                        <p className="text-slate-400 text-base mb-6">Your new wallet is now active. The previous address is no longer used by Loofta.</p>
                        <button
                          type="button"
                          onClick={() => { setShowRotateConfirm(false); setRotateState("idle"); setNewWalletAddress(""); }}
                          className="w-full py-3 rounded-xl text-base font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
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
                        <p className="text-slate-400 text-base mb-1">A new Solana wallet will be created and used for all future payments on Loofta.</p>
                        <p className="text-slate-500 text-base mb-6">Your previous wallet stays in Privy but won&apos;t be used by Loofta anymore.</p>
                        {rotateState === "error" && (
                          <p className="text-red-400 text-base mb-3">{rotateError}</p>
                        )}
                        <div className="flex gap-3 w-full">
                          <button
                            type="button"
                            disabled={rotateState === "loading"}
                            onClick={() => { setShowRotateConfirm(false); setRotateState("idle"); setRotateError(""); }}
                            className="flex-1 py-3 rounded-xl text-base font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors disabled:opacity-50"
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
                            className="flex-1 py-3 rounded-xl text-base font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
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
                    <div className="space-y-6">

                      <section>
                        <p className={settingsSectionLabelClass}>Payment link</p>
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 space-y-3">
                          {paymentLinkLabel ? (
                            <div className="flex items-center gap-2 rounded-xl bg-black/25 border border-white/[0.06] pl-3.5 pr-1.5 py-1.5">
                              <span className="flex-1 min-w-0 truncate text-base text-slate-200">{paymentLinkLabel}</span>
                              <button type="button" onClick={copyPaymentLink} className={settingsPillClass}>
                                {linkCopied ? t('copied') : 'Copy'}
                              </button>
                            </div>
                          ) : null}

                          {(storeLooUsername || (storeTwitterUsername && hasTwitterLinked)) && (
                            <div className={`grid gap-2 ${storeLooUsername && storeTwitterUsername && hasTwitterLinked ? "grid-cols-2" : "grid-cols-1"}`}>
                              {storeLooUsername && (
                                <button
                                  type="button"
                                  disabled={switchingUsername}
                                  onClick={() => { if (!looActive) void handleSwitchUsername("loo"); }}
                                  className={`flex items-center gap-2.5 min-w-0 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:opacity-60 ${looActive ? "bg-white/[0.08] border-white/15" : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"}`}
                                >
                                  <SettingsIconTile className="bg-[#2A2A32] text-white text-sm font-bold">L</SettingsIconTile>
                                  <span className="flex-1 min-w-0">
                                    <span className="block truncate text-sm font-semibold text-white">@{storeLooUsername}</span>
                                    <span className="block text-sm text-slate-500 leading-snug">Loofta username</span>
                                  </span>
                                  {switchingUsername && !looActive ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" /> : <SettingsRadio selected={looActive} />}
                                </button>
                              )}
                              {storeTwitterUsername && hasTwitterLinked && (
                                <button
                                  type="button"
                                  disabled={switchingUsername}
                                  onClick={() => { if (!xActive) void handleSwitchUsername("twitter"); }}
                                  className={`flex items-center gap-2.5 min-w-0 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:opacity-60 ${xActive ? "bg-white/[0.08] border-white/15" : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"}`}
                                >
                                  <SettingsIconTile className="bg-black border border-white/10 text-white">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                    </svg>
                                  </SettingsIconTile>
                                  <span className="flex-1 min-w-0">
                                    <span className="block truncate text-sm font-semibold text-white">@{storeTwitterUsername}</span>
                                    <span className="block text-sm text-slate-500 leading-snug">X username</span>
                                  </span>
                                  {switchingUsername && !xActive ? <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" /> : <SettingsRadio selected={xActive} />}
                                </button>
                              )}
                            </div>
                          )}

                          {canUpdateToTwitter && twitterHandle && !storeTwitterUsername && (
                            <button
                              type="button"
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
                                  window.location.reload();
                                } catch {
                                  toast({ variant: "destructive", title: "Update failed", description: "Try again." });
                                } finally {
                                  setUpdatingToTwitter(false);
                                }
                              }}
                              className="text-sm font-medium text-slate-300 hover:text-white transition-colors disabled:opacity-50"
                            >
                              {updatingToTwitter ? "Setting…" : `Use @${twitterHandle} as your payment link`}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setShowChangeUsername(true)}
                            className="px-1 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                          >
                            Change Loofta username
                          </button>
                        </div>
                      </section>

                      <button
                        type="button"
                        disabled={savingPrivatePayments}
                        onClick={async () => {
                          const next = !requirePrivatePayments;
                          setSavingPrivatePayments(true);
                          try {
                            const token = await getAccessToken();
                            const backendUrl = clientApiBase();
                            const r = await fetch(`${backendUrl}/users/me/private-payments`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                              body: JSON.stringify({ enabled: next }),
                            });
                            if (!r.ok) throw new Error("Could not save");
                            setRequirePrivatePayments(next);
                          } catch {
                            toast({ variant: "destructive", title: "Couldn't update private payments" });
                          } finally {
                            setSavingPrivatePayments(false);
                          }
                        }}
                        aria-pressed={requirePrivatePayments}
                        className="w-full flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3.5 text-left disabled:opacity-60"
                      >
                        <SettingsIconTile className="bg-gradient-to-b from-[#FF6A2A] to-[#E23B12] text-white">
                          <Shield className="w-5 h-5" fill="currentColor" />
                        </SettingsIconTile>
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-semibold text-white">Only accept private payments</span>
                          <span className="block text-sm text-slate-500 mt-0.5">Senders must pay privately and cover the privacy fee.</span>
                        </span>
                        <span className={`shrink-0 h-7 w-12 rounded-full p-0.5 transition-colors ${requirePrivatePayments ? "bg-gradient-to-r from-[#FF4D1C] to-[#FF9A1E]" : "bg-white/15"}`}>
                          <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${requirePrivatePayments ? "translate-x-5" : ""}`} />
                        </span>
                      </button>

                      <section>
                        <p className={settingsSectionLabelClass}>Accounts</p>
                        <p className="mb-3 text-sm text-slate-500 leading-snug">People can pay you by handle on any connected account.</p>
                        {totalMethods < 2 && (
                          <div className="mb-3 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                            <p className="text-sm text-amber-300/90 leading-snug">{t('addSecondMethod')}</p>
                          </div>
                        )}
                        <div className="space-y-2">
                          <SettingsAccountRow
                            icon={
                              <SettingsIconTile className="bg-[#2A2A32] text-slate-200">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                  <polyline points="22,6 12,13 2,6" />
                                </svg>
                              </SettingsIconTile>
                            }
                            title={hasEmail && linkedEmailAddress ? linkedEmailAddress : "Email"}
                            subtitle={hasEmail && linkedEmailAddress ? "Sign-in" : "Not connected"}
                            action={hasEmail && linkedEmailAddress ? (
                              totalMethods > 1 ? (
                                <button type="button" onClick={handleUnlinkEmail} disabled={unlinkingEmail} className={settingsRemoveClass}>
                                  {unlinkingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
                                </button>
                              ) : null
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  setLinkingMethod("email");
                                  try { await linkEmail(); } catch { /* surfaced via onError */ }
                                }}
                                className={settingsPillClass}
                              >
                                Connect
                              </button>
                            )}
                          />

                          <SettingsAccountRow
                            icon={
                              <SettingsIconTile className="bg-black border border-white/10 text-white">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                </svg>
                              </SettingsIconTile>
                            }
                            title={hasTwitterLinked && twitterHandle ? `@${twitterHandle}` : "X"}
                            subtitle={hasTwitterLinked && twitterHandle ? "Sign-in · Get paid by handle" : "Not connected"}
                            action={hasTwitterLinked && twitterHandle ? (
                              totalMethods > 1 ? (
                                confirmUnlinkTwitter ? (
                                  <span className="flex items-center gap-2 shrink-0">
                                    <button type="button" onClick={() => setConfirmUnlinkTwitter(false)} className={settingsRemoveClass}>Cancel</button>
                                    <button type="button" onClick={handleUnlinkTwitter} disabled={unlinkingTwitter} className="shrink-0 text-sm font-medium text-red-400 hover:text-red-300 transition-colors disabled:opacity-40">
                                      {unlinkingTwitter ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
                                    </button>
                                  </span>
                                ) : (
                                  <button type="button" onClick={() => setConfirmUnlinkTwitter(true)} disabled={unlinkingTwitter} className={settingsRemoveClass}>
                                    Remove
                                  </button>
                                )
                              ) : null
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  setLinkingMethod("twitter");
                                  try { await linkTwitter(); } catch { /* surfaced via onError */ }
                                }}
                                className={settingsPillClass}
                              >
                                Connect
                              </button>
                            )}
                            note={confirmUnlinkTwitter && twitterHandle ? (
                              <p className="mt-2 ml-12 text-sm text-amber-300/90 leading-snug">
                                {username?.toLowerCase() === twitterHandle.toLowerCase()
                                  ? `Your payment link will switch to @${storeLooUsername ?? `loo-${username?.slice(0, 16)}`}.`
                                  : "Your payment link username stays the same."}
                                {" "}Are you sure?
                              </p>
                            ) : null}
                          />

                          <SettingsAccountRow
                            icon={
                              <SettingsIconTile className="bg-[#2AABEE] text-white">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                                </svg>
                              </SettingsIconTile>
                            }
                            title={hasTelegramLinked && telegramDisplayHandle ? `@${telegramDisplayHandle}` : "Telegram"}
                            subtitle={
                              hasTelegramLinked && telegramDisplayHandle
                                ? privyTelegram ? "Sign-in · Get paid by handle" : "Get paid by handle · Reconnect to sign in with Telegram"
                                : "Not connected"
                            }
                            action={hasTelegramLinked && telegramDisplayHandle && !privyTelegram ? (
                              // Saved from the old loofta.com relay but not linked in Privy: reconnect
                              // once so Telegram login lands on this account.
                              <button type="button" onClick={handleConnectTelegram} disabled={connectingTelegram} className={settingsPillClass}>
                                {connectingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Reconnect"}
                              </button>
                            ) : hasTelegramLinked && telegramDisplayHandle ? (
                              <button type="button" onClick={handleUnlinkTelegram} disabled={unlinkingTelegram} className={settingsRemoveClass}>
                                {unlinkingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
                              </button>
                            ) : (
                              <button type="button" onClick={handleConnectTelegram} disabled={connectingTelegram} className={settingsPillClass}>
                                {connectingTelegram ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Connect"}
                              </button>
                            )}
                          />

                          <SettingsAccountRow
                            icon={
                              <SettingsIconTile className="bg-[#2A2A32] text-white">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                  <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.207 11.387.6.113.793-.26.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.303 24 12c0-6.627-5.373-12-12-12z" />
                                </svg>
                              </SettingsIconTile>
                            }
                            title={hasGithubLinked && githubHandle ? `@${githubHandle}` : "GitHub"}
                            subtitle={hasGithubLinked && githubHandle ? "Get paid by handle" : "Not connected"}
                            action={hasGithubLinked && githubHandle ? (
                              <button type="button" onClick={handleUnlinkGithub} disabled={unlinkingGithub} className={settingsRemoveClass}>
                                {unlinkingGithub ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  setLinkingMethod("github");
                                  try { await linkGithub(); } catch { /* surfaced via onError */ }
                                }}
                                className={settingsPillClass}
                              >
                                Connect
                              </button>
                            )}
                          />

                          <SettingsAccountRow
                            icon={
                              <SettingsIconTile className="bg-[#5865F2] text-white">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                  <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
                                </svg>
                              </SettingsIconTile>
                            }
                            title={hasDiscordLinked && discordHandle ? `@${discordHandle}` : "Discord"}
                            subtitle={hasDiscordLinked && discordHandle ? "Get paid by handle" : "Not connected"}
                            action={hasDiscordLinked && discordHandle ? (
                              <button type="button" onClick={handleUnlinkDiscord} disabled={unlinkingDiscord} className={settingsRemoveClass}>
                                {unlinkingDiscord ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  setLinkingMethod("discord");
                                  try { await linkDiscord(); } catch { /* surfaced via onError */ }
                                }}
                                className={settingsPillClass}
                              >
                                Connect
                              </button>
                            )}
                          />
                        </div>
                      </section>

                      <section>
                        <p className={settingsSectionLabelClass}>Wallet</p>
                        {walletAddress ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-500">Solana address</p>
                                <p className="mt-0.5 text-base font-medium text-white break-all">{walletAddress}</p>
                              </div>
                              <button type="button" onClick={() => copyToClipboard(walletAddress, false)} className={settingsPillClass}>
                                {copied ? (
                                  t('copied')
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    Copy
                                  </>
                                )}
                              </button>
                            </div>

                            <button
                              type="button"
                              disabled={exportingWallet}
                              onClick={handleExportWallet}
                              className="w-full flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3 text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                            >
                              <SettingsIconTile className="bg-[#2A2A32] text-slate-200">
                                {exportingWallet ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                              </SettingsIconTile>
                              <span className="flex-1 min-w-0">
                                <span className="block text-base font-medium text-white">{exportingWallet ? t('exportingWallet') : "Export wallet"}</span>
                                <span className="block text-sm text-slate-500">Reveal your private key</span>
                              </span>
                              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                            </button>

                            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3">
                              <SettingsIconTile className="bg-[#2A2A32] text-slate-200">
                                <RefreshCw className="w-4 h-4" />
                              </SettingsIconTile>
                              <div className="flex-1 min-w-0">
                                <p className="text-base font-medium text-white">New wallet address</p>
                                {walletRotateBlocked && (
                                  <p className="text-sm text-amber-400 leading-snug">Withdraw until your balance is below $0.10 first</p>
                                )}
                              </div>
                              <button
                                type="button"
                                disabled={walletRotateBlocked}
                                onClick={() => setShowRotateConfirm(true)}
                                className={settingsPillClass}
                              >
                                Generate
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-5 text-center">
                            {!privyReady ? (
                              <p className="text-base text-slate-500">{t('loadingWallet')}</p>
                            ) : (
                              <p className="text-base text-slate-500">{t('walletAutoCreated')}</p>
                            )}
                          </div>
                        )}
                      </section>

                    </div>
                  </>
                )}
              </div>

            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Change Username Modal */}
      <ChangeUsernameModal
        open={showChangeUsername}
        onClose={() => setShowChangeUsername(false)}
        currentUsername={username ?? null}
        storeLooUsername={storeLooUsername}
        storeTwitterUsername={storeTwitterUsername}
        onSaved={(newUsername, looUsername, twitterUsername) => {
          setUsername(newUsername);
          setLooUsername(looUsername ?? null);
          if (twitterUsername !== null) setTwitterUsername(twitterUsername);
        }}
      />

    </div>
  );
}
