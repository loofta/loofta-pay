"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useAuthStore } from "@/store/auth";
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

interface UserMenuProps {
  username: string | null;
  email: string | undefined;
  isDarkPage: boolean;
  onLogout: () => void;
}

export function UserMenu({ username: usernameProp, email: emailProp, isDarkPage, onLogout }: UserMenuProps) {
  // Get email and username from store as fallback (always persistent)
  const storeEmail = useAuthStore((s) => s.email);
  const storeUsername = useAuthStore((s) => s.username ?? null);
  const setAuth = useAuthStore((s) => s.setAuth);

  // Use props if available, otherwise fallback to store
  const username = usernameProp ?? storeUsername;
  const email = emailProp ?? storeEmail;

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
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ready: privyReady, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { wallets } = useWallets();
  const { toast } = useToast();

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
              'x-privy-user-id': privyUser.id,
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
          'x-privy-user-id': privyUser.id,
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
        <span className="text-sm font-medium">{username || email}</span>
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
                  <p className={`text-xs font-medium mb-1 ${isDarkPage ? "text-gray-400" : "text-gray-500"
                    }`}>
                    Username
                  </p>
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold ${isDarkPage ? "text-white" : "text-gray-900"
                      }`}>
                      @{username}
                    </p>
                    <button
                      onClick={() => copyToClipboard(`@${username}`)}
                      className={`p-1 rounded hover:bg-opacity-20 ${isDarkPage ? "hover:bg-white" : "hover:bg-gray-200"
                        }`}
                      title="Copy username"
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
                  <p className={`text-xs font-medium mb-1 ${isDarkPage ? "text-gray-400" : "text-gray-500"
                    }`}>
                    Email
                  </p>
                  <div className="flex items-center justify-between">
                    <p className={`text-sm ${isDarkPage ? "text-white/90" : "text-gray-700"
                      }`}>
                      {email}
                    </p>
                  </div>
                </div>
              )}

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
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${isDarkPage
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
                  Share your link
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
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${isDarkPage
                  ? "text-gray-300 hover:bg-gray-800"
                  : "text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                Settings
              </button>
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
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${isDarkPage
                ? "text-red-400 hover:bg-red-400/10"
                : "text-red-600 hover:bg-red-50"
                }`}
            >
              Log out
            </button>
          </div>
        </div>
      )}

      {/* Share Modal - matching onboarding style */}
      {showShareModal && username && (() => {
        const modalContent = (
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
                className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Content */}
                <div className="p-8">
                  {/* Icon */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6 flex justify-center"
                  >
                    <div
                      className="w-24 h-24 rounded-full flex items-center justify-center mx-auto"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,15,0,0.15) 0%, rgba(234,179,8,0.15) 100%)",
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
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                      Start receiving money now
                    </h2>
                    <p className="text-base text-gray-600">
                      Share your payment link to receive payments
                    </p>
                  </motion.div>



                  {/* Payment Link Display */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-6 p-4 rounded-xl bg-gray-50 border border-gray-200"
                  >
                    <p className="text-sm font-medium mb-2 text-gray-500">
                      Your payment link
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={getPaymentLink() || ""}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-sm font-mono truncate hover:underline text-orange-600"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {getPaymentLink()?.replace(/^https?:\/\//, "") || ""}
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPaymentLink();
                        }}
                        className={`p-2 rounded hover:bg-gray-200 transition-colors flex-shrink-0 ${linkCopied ? "bg-green-100" : ""}`}
                        title={linkCopied ? "Copied!" : "Copy link"}
                      >
                        {linkCopied ? (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-green-500"
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
                            className="text-gray-500"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        )}
                      </button>
                    </div>
                  </motion.div>

                  {/* Private Payment Option */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className={`mb-6 p-4 rounded-xl border ${requirePrivatePayments
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-gray-50 border-gray-200'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-base font-semibold text-gray-900">
                            🔒 Require Private Payments Only
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          When enabled, all payments to your link must use Privacy Cash for complete privacy.
                          You will be charged additional fees: 0.35% + $0.74 per payment.
                        </p>
                      </div>
                      {loadingPreferences ? (
                        <div className="h-6 w-11 rounded-full bg-gray-200 animate-pulse" />
                      ) : (
                        <Switch
                          checked={requirePrivatePayments}
                          onCheckedChange={handleTogglePrivatePayments}
                          disabled={updatingPreferences}
                          className="data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                        />
                      )}
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
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-gray-600">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.12l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
                      </svg>
                      <span className="text-xs font-medium text-gray-700">
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
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-gray-600">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                      <span className="text-xs font-medium text-gray-700">
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
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                      </svg>
                      <span className="text-xs font-medium text-gray-700">
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
                      className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 hover:scale-105"
                      style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
                    >
                      {linkCopied ? (
                        <span className="flex items-center justify-center gap-2">
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
                          Copied!
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
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
                          Copy Link
                        </span>
                      )}
                    </button>
                  </motion.div>
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

      {/* Settings Modal - wallet address, export private keys, etc. */}
      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Settings
            </DialogTitle>
            <DialogDescription>
              Wallet address and security options.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {walletAddress ? (
              <>
                {/* Wallet Address */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Wallet Address</Label>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                    <p
                      className="flex-1 text-sm font-mono break-all cursor-pointer hover:opacity-80"
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
                      className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 shrink-0"
                      title={copied ? "Copied!" : "Copy"}
                    >
                      {copied ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{showFullAddress ? "Click to show shortened" : "Click address to copy full"}</p>
                </div>

                {/* Wallet actions */}
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setShowSettingsModal(false);
                      window.open(`https://solscan.io/account/${walletAddress}`, '_blank');
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    View on Solscan
                  </button>
                  <button
                    onClick={() => {
                      setShowSettingsModal(false);
                      setShowWithdrawModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Withdraw
                  </button>
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
                        const privateKey = await exportWallet({ address: walletAddress });
                        if (privateKey && typeof privateKey === 'string') {
                          setExportedPrivateKey(privateKey);
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
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    Export Private Key
                  </button>
                </div>
              </>
            ) : (
              <div className="py-4 text-center">
                {!privyReady ? (
                  <p className="text-sm text-gray-500">Loading wallet...</p>
                ) : (
                  <p className="text-sm text-gray-500">Wallet will be created automatically when needed.</p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                  <Label className="text-sm font-medium mb-2 block">Your Private Key:</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono break-all p-2 bg-white dark:bg-gray-800 rounded border">
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
                  <p className="text-sm text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> Never share this private key with anyone. Store it securely and never store it in plain text online.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Loading private key...</p>
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

      {/* Withdraw Modal */}
      <Dialog open={showWithdrawModal} onOpenChange={setShowWithdrawModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw Funds</DialogTitle>
            <DialogDescription>
              Send funds from your wallet to another Solana address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="withdraw-address">Recipient Address</Label>
              <Input
                id="withdraw-address"
                placeholder="Enter Solana address"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
              <Input
                id="withdraw-amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> You'll need SOL for transaction fees. Make sure you have enough SOL in your wallet.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowWithdrawModal(false);
                setWithdrawAddress("");
                setWithdrawAmount("");
              }}
              disabled={withdrawing}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!withdrawAddress || !withdrawAmount) {
                  toast({
                    variant: "destructive",
                    title: "Missing information",
                    description: "Please enter both recipient address and amount.",
                  });
                  return;
                }

                // Validate Solana address format
                if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(withdrawAddress)) {
                  toast({
                    variant: "destructive",
                    title: "Invalid address",
                    description: "Please enter a valid Solana address.",
                  });
                  return;
                }

                const amount = parseFloat(withdrawAmount);
                if (isNaN(amount) || amount <= 0) {
                  toast({
                    variant: "destructive",
                    title: "Invalid amount",
                    description: "Please enter a valid amount greater than 0.",
                  });
                  return;
                }

                setWithdrawing(true);
                try {
                  // Note: This is a placeholder. You'll need to implement actual USDC transfer
                  // using Privy's wallet signing capabilities or your backend API
                  toast({
                    title: "Withdrawal initiated",
                    description: `Withdrawing $${amount.toFixed(2)} USDC to ${withdrawAddress.slice(0, 8)}...`,
                  });
                  
                  // TODO: Implement actual withdrawal logic
                  // This would involve:
                  // 1. Getting the Solana wallet from useWallets
                  // 2. Creating a USDC transfer transaction
                  // 3. Signing and sending the transaction
                  
                  setShowWithdrawModal(false);
                  setWithdrawAddress("");
                  setWithdrawAmount("");
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Withdrawal failed",
                    description: error?.message || "Failed to process withdrawal. Please try again.",
                  });
                } finally {
                  setWithdrawing(false);
                }
              }}
              disabled={withdrawing || !withdrawAddress || !withdrawAmount}
            >
              {withdrawing ? "Processing..." : "Withdraw"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
