"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";

const LOO_PREFIX = "loo-";

/** Privy uses type "twitter_oauth" for Twitter. */
const TWITTER_TYPES = ["twitter_oauth", "twitter", "x"] as const;

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

interface WelcomeOnboardingProps {
  open: boolean;
  onClose: (dontShowAgain: boolean) => void;
  username: string | null;
  privyUserId?: string;
  onEditUsername?: () => void;
}

const TOTAL_STEPS = 5; // welcome, username, pay friend, top up, share

export function WelcomeOnboarding({ open, onClose, username, privyUserId, onEditUsername }: WelcomeOnboardingProps) {
  const { getAccessToken, user: privyUser } = usePrivy();
  const [emailLinkError, setEmailLinkError] = useState<"already_linked" | null>(null);
  const { linkEmail, linkTwitter } = useLinkAccount({
    onSuccess: (arg: { linkedAccount?: { type?: string }; linkMethod?: string } | undefined) => {
      const isEmail = arg?.linkedAccount?.type === "email" || arg?.linkMethod === "email";
      const isTwitter = arg?.linkedAccount?.type === "twitter_oauth" || arg?.linkedAccount?.type === "twitter" || arg?.linkedAccount?.type === "x" || arg?.linkMethod === "twitter";
      if (isEmail) {
        setEmailLinkError(null);
        setEmailStepDone(true);
      }
      if (isTwitter) setTwitterStepDone(true);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
      if (/already been linked|already linked|linked to another user/i.test(msg)) {
        setEmailLinkError("already_linked");
      }
    },
  });
  const hasEmail = (privyUser?.linkedAccounts || []).some((a: { type?: string }) => a.type === "email");
  const twitterUsername = useMemo(
    () => getTwitterUsername(privyUser?.linkedAccounts as Array<{ type?: string; username?: string; name?: string; subject?: string }> | undefined),
    [privyUser?.linkedAccounts]
  );
  const hasTwitter = !!twitterUsername;
  const [emailStepDone, setEmailStepDone] = useState(false);
  const [twitterStepDone, setTwitterStepDone] = useState(false);
  const [step, setStep] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [requirePrivatePayments, setRequirePrivatePayments] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [updatingPreferences, setUpdatingPreferences] = useState(false);

  const showAddEmailStep = open && !hasEmail && !emailStepDone;
  const showAddTwitterStep = open && !showAddEmailStep && !hasTwitter && !twitterStepDone;
  const usernameFromTwitter = !!twitterUsername;

  const getPaymentLink = () => {
    const u = username || newUsername.trim() || "username";
    const baseUrl = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.xyz";
    return `${baseUrl}/link/@${u}`;
  };

  const copyToClipboard = (text: string, isLink: boolean) => {
    navigator.clipboard.writeText(text);
    if (isLink) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const copyPaymentLink = () => {
    const link = getPaymentLink();
    if (link) copyToClipboard(link, true);
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

  const fullTexts = [
    `Pay your friend\nsend money to @${username || "username"}`,
    "Top up with your favorite\nwallet and token",
  ];

  // Reset step when modal opens. Twitter → @handle (read-only). No Twitter → loo- + editable suffix.
  useEffect(() => {
    if (open) {
      setStep(0);
      setEmailStepDone(hasEmail);
      setTwitterStepDone(hasTwitter);
      setEmailLinkError(null);
      setDisplayText("");
      setDontShowAgain(false);
      if (twitterUsername) {
        setNewUsername(twitterUsername);
      } else if (username && username.startsWith(LOO_PREFIX)) {
        setNewUsername(username);
      } else {
        setNewUsername(LOO_PREFIX);
      }
      setUsernameError(null);
      setUsernameAvailable(twitterUsername ? true : null);
      setCheckingAvailability(false);
      setLinkCopied(false);
    }
  }, [open, username, hasEmail, hasTwitter, twitterUsername]);

  // Fetch user preferences when on step 4 (share step)
  useEffect(() => {
    if (step === 4 && open && getAccessToken && privyUser?.id) {
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
          }
        } catch (error) {
          console.error('[WelcomeOnboarding] Failed to fetch preferences:', error);
        } finally {
          setLoadingPreferences(false);
        }
      };
      fetchPreferences();
    }
  }, [step, open, getAccessToken, privyUser?.id]);

  const handleTogglePrivatePayments = async (checked: boolean) => {
    if (!getAccessToken || !privyUser?.id) return;
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
      }
    } catch (error) {
      console.error('[WelcomeOnboarding] Failed to update preferences:', error);
    } finally {
      setUpdatingPreferences(false);
    }
  };

  // Check username availability with debounce (only when user can choose — not when username is from Twitter)
  useEffect(() => {
    if (step !== 1 || usernameFromTwitter) return;

    const trimmed = newUsername.trim();

    if (!trimmed || (trimmed.startsWith(LOO_PREFIX) && trimmed.length <= LOO_PREFIX.length)) {
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingAvailability(false);
      return;
    }

    const validationError = validateUsername(trimmed);
    if (validationError) {
      setUsernameError(validationError);
      setUsernameAvailable(false);
      setCheckingAvailability(false);
      return;
    }

    if (trimmed.toLowerCase() === username?.toLowerCase()) {
      setUsernameError(null);
      setUsernameAvailable(true);
      setCheckingAvailability(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setCheckingAvailability(true);
      setUsernameError(null);

      try {
        const response = await fetch("/api/users/check-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: trimmed,
            privyUserId,
          }),
        });

        const data = await response.json();

        if (data.available) {
          setUsernameAvailable(true);
          setUsernameError(null);
        } else {
          setUsernameAvailable(false);
          setUsernameError(data.error || "Username is not available");
        }
      } catch (err: any) {
        setUsernameAvailable(false);
        setUsernameError("Failed to check username availability");
      } finally {
        setCheckingAvailability(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [newUsername, step, username, privyUserId, usernameFromTwitter]);

  // Validate username: Twitter-style [a-zA-Z0-9_]{3,20} or loo- + suffix [a-zA-Z0-9_]{1,16}
  const validateUsername = (value: string): string | null => {
    const trimmed = value.trim();
    if (trimmed.startsWith(LOO_PREFIX)) {
      const suffix = trimmed.slice(LOO_PREFIX.length);
      if (suffix.length < 1) return "Choose at least 1 character after loo-";
      if (suffix.length > 16) return "Maximum 16 characters after loo-";
      if (!/^[a-zA-Z0-9_]+$/.test(suffix)) return "Only letters, numbers, and underscores after loo-";
      return null;
    }
    if (trimmed.length < 3) return "Username must be at least 3 characters";
    if (trimmed.length > 20) return "Username must be 20 characters or less";
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return "Username can only contain letters, numbers, and underscores";
    return null;
  };

  // Handle username save (called when clicking Next on step 1)
  const handleSaveUsername = async (): Promise<boolean> => {
    const trimmed = newUsername.trim();

    if (!trimmed) {
      setUsernameError("Username cannot be empty");
      return false;
    }

    const validationError = validateUsername(trimmed);
    if (validationError) {
      setUsernameError(validationError);
      return false;
    }

    if (!usernameFromTwitter && usernameAvailable === false) {
      setUsernameError("Please choose an available username");
      return false;
    }

    // If username hasn't changed, no need to save
    if (trimmed.toLowerCase() === username?.toLowerCase()) {
      return true;
    }

    // Save username
    try {
      const response = await fetch("/api/users/setup-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privyUserId,
          username: trimmed,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to set username");
      }

      // Username saved successfully
      setUsernameError(null);

      // Trigger a callback to update parent component
      if (onEditUsername) {
        setTimeout(() => {
          onEditUsername();
        }, 100);
      }

      return true;
    } catch (err: any) {
      setUsernameError(err.message || "Failed to set username. Please try again.");
      return false;
    }
  };

  // Animated text typing effect
  useEffect(() => {
    if (!open) {
      setDisplayText("");
      return;
    }

    // Only show typing animation for steps 2, 3 (pay friend, top up; step 4 is share)
    if (step < 2 || step > 3) {
      setDisplayText("");
      return;
    }

    const textIndex = step - 2; // Map step 2->0, 3->1
    const currentText = fullTexts[textIndex];
    if (!currentText) return;

    let currentIndex = 0;
    setDisplayText("");

    const interval = setInterval(() => {
      if (currentIndex < currentText.length) {
        setDisplayText(currentText.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(interval);
      }
    }, 30); // Typing speed

    return () => clearInterval(interval);
  }, [step, open]);

  const handleNext = async () => {
    // If on step 1, save username first before proceeding
    if (step === 1) {
      const saved = await handleSaveUsername();
      if (!saved) {
        return; // Don't proceed if username save failed
      }
    }

    if (step < 4) {
      setStep(step + 1);
    } else {
      // Save preference to database if checkbox is checked
      if (dontShowAgain && privyUserId) {
        try {
          await fetch("/api/users/set-onboarding-preference", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              privyUserId,
              skipOnboarding: true,
            }),
          });
        } catch (error) {
          console.error("[WelcomeOnboarding] Error saving preference:", error);
        }
      }
      onClose(dontShowAgain);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleSkip = async () => {
    // Save preference to database if checkbox is checked
    if (dontShowAgain && privyUserId) {
      try {
        await fetch("/api/users/set-onboarding-preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            privyUserId,
            skipOnboarding: true,
          }),
        });
      } catch (error) {
        console.error("[WelcomeOnboarding] Error saving preference:", error);
      }
    }
    onClose(dontShowAgain);
  };

  if (!open) return null;

  // Render in portal to ensure it's centered on screen, not in header
  const modalContent = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#0f0f12] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        >
          {/* Add email step (before main onboarding) */}
          {showAddEmailStep && (
            <div className="p-5 space-y-5">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">Add a second sign-in method</h2>
                <p className="text-sm text-slate-400">
                  Add your email for account recovery and easier sign-in next time.
                </p>
              </div>
              {emailLinkError === "already_linked" && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
                  <p className="text-sm text-amber-200">
                    This email is already linked to another Loofta account. You can continue with Twitter only, or sign out and sign in with that email to use the other account.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmailLinkError(null);
                    linkEmail();
                  }}
                  className="w-full py-2.5 rounded-xl font-medium text-white bg-gradient-to-r from-[#FF1301] to-[#EAB308] hover:opacity-90 transition-opacity"
                >
                  Add email
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmailLinkError(null);
                    setEmailStepDone(true);
                  }}
                  className="w-full py-2.5 rounded-xl font-medium text-slate-400 hover:text-white transition-colors"
                >
                  {emailLinkError === "already_linked" ? "Continue with Twitter only" : "Skip for now"}
                </button>
              </div>
            </div>
          )}

          {/* Add Twitter step: get payment link = exact Twitter username */}
          {showAddTwitterStep && (
            <div className="p-5 space-y-5">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">Add Twitter to get your exact @username</h2>
                <p className="text-sm text-slate-400">
                  Your payment link will match your Twitter handle exactly (e.g. @you → pay.loofta.xyz/link/@you).
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => linkTwitter()}
                  className="w-full py-2.5 rounded-xl font-medium text-white bg-gradient-to-r from-[#FF1301] to-[#EAB308] hover:opacity-90 transition-opacity"
                >
                  Add Twitter
                </button>
                <button
                  type="button"
                  onClick={() => setTwitterStepDone(true)}
                  className="w-full py-2.5 rounded-xl font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {!showAddEmailStep && !showAddTwitterStep && (
            <>
          {/* Progress bar */}
          <div className="flex gap-1 p-3 pb-0">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full"
                  style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
                  initial={{ width: 0 }}
                  animate={{ width: step >= i ? "100%" : "0%" }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="relative h-[320px] overflow-hidden">
            {/* Step 0: Welcome */}
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-4"
                  >
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,15,0,0.2) 0%, rgba(234,179,8,0.2) 100%)",
                      }}
                    >
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-amber-400">
                        <path
                          d="M20 6L9 17l-5-5"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-xl font-bold text-white mb-2"
                  >
                    Welcome to Loofta Pay!
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-sm text-slate-400 mb-1"
                  >
                    Your universal private payment account
                  </motion.p>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-xs text-slate-500"
                  >
                    Pay & receive crypto privately
                  </motion.p>
                </motion.div>
              )}

              {/* Step 1: Username = Twitter handle (read-only) */}
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-3"
                  >
                    <div className="text-4xl mb-2">✏️</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-lg font-bold text-white mb-2"
                  >
                    {usernameFromTwitter ? "Your username is your Twitter handle" : "Choose your username"}
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-sm text-slate-400 mb-4"
                  >
                    {usernameFromTwitter
                      ? "Your payment link will use this username. It can't be changed."
                      : username?.startsWith(LOO_PREFIX)
                        ? "The loo- part is fixed. Add Twitter later to get a unique @handle."
                        : "Your link will be @loo-yourname. Add Twitter later to get @yourhandle."}
                  </motion.p>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 }}
                    className="flex flex-col items-center gap-2 w-full max-w-xs"
                  >
                    <div className="w-full space-y-2">
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-500 font-semibold text-base">@</span>
                        {usernameFromTwitter ? (
                          <>
                            <span className="absolute left-8 text-white font-medium text-base">{newUsername}</span>
                            <div className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-white/20 bg-white/5 text-base cursor-default min-h-[42px]" />
                            <div className="absolute right-3">
                              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className={`flex items-center w-full rounded-xl border pr-10 py-2.5 pl-3 bg-white/5 text-base ${checkingAvailability
                                ? "border-white/20"
                                : usernameAvailable === true
                                  ? "border-emerald-500/70 focus-within:ring-2 focus-within:ring-emerald-500/30"
                                  : usernameAvailable === false
                                    ? "border-red-500/70 focus-within:ring-2 focus-within:ring-red-500/30"
                                    : "border-white/20 focus-within:ring-2 focus-within:ring-amber-500/30"
                              } focus-within:outline-none`}
                            >
                              <span className="text-slate-500 font-semibold shrink-0">@</span>
                              <span className="text-slate-400 font-medium shrink-0 ml-0.5">{LOO_PREFIX}</span>
                              <input
                                type="text"
                                value={newUsername.startsWith(LOO_PREFIX) ? newUsername.slice(LOO_PREFIX.length) : ""}
                                onChange={(e) => {
                                  const suffix = e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16);
                                  setNewUsername(LOO_PREFIX + suffix);
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleNext(); }}
                                placeholder="yourname"
                                className="flex-1 min-w-0 bg-transparent border-0 py-0 text-white placeholder:text-slate-500 font-medium focus:ring-0 focus:outline-none"
                                autoFocus
                                maxLength={16}
                              />
                            </div>
                            {checkingAvailability && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                              </div>
                            )}
                            {!checkingAvailability && usernameAvailable === true && newUsername.length > LOO_PREFIX.length && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                            {!checkingAvailability && usernameAvailable === false && newUsername.length > LOO_PREFIX.length && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {usernameError && (
                        <p className="text-xs text-red-400 text-center">{usernameError}</p>
                      )}
                      {!usernameError && !usernameFromTwitter && checkingAvailability && newUsername.length > LOO_PREFIX.length && (
                        <p className="text-xs text-slate-500 text-center">Checking availability...</p>
                      )}
                      {!usernameError && !usernameFromTwitter && !checkingAvailability && usernameAvailable === true && newUsername.length > LOO_PREFIX.length && (
                        <p className="text-xs text-emerald-400 text-center">✓ Username available</p>
                      )}
                      {!usernameFromTwitter && (
                        <p className="text-[10px] text-slate-500 text-center">
                          loo- is fixed. 1–16 letters, numbers, underscores after it.
                        </p>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}

              {/* Step 2: Pay friend */}
              {step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"
                >
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15 }} className="mb-3">
                    <div className="text-4xl mb-2">💸</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-lg font-bold text-white mb-4 min-h-[56px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[0].length && <span className="animate-pulse">|</span>}
                  </motion.h2>
                </motion.div>
              )}

              {/* Step 3: Top up */}
              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"
                >
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15 }} className="mb-3">
                    <div className="text-4xl mb-2">💳</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-lg font-bold text-white mb-4 min-h-[56px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[1].length && <span className="animate-pulse">|</span>}
                  </motion.h2>
                </motion.div>
              )}

              {/* Step 4: Share link */}
              {step === 4 && (
                <motion.div
                  key="step4"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 overflow-y-auto p-4"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-3 flex justify-center"
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,15,0,0.2) 0%, rgba(234,179,8,0.2) 100%)",
                      }}
                    >
                      <span className="text-2xl">💰</span>
                    </div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-lg font-bold text-white mb-1 text-center"
                  >
                    Start receiving money now
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="text-xs text-slate-400 mb-3 text-center"
                  >
                    Share your payment link to receive payments
                  </motion.p>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-3 p-2.5 rounded-xl bg-white/5 border border-white/10"
                  >
                    <p className="text-[10px] font-medium mb-1.5 text-slate-500">Your payment link</p>
                    <div className="flex items-center gap-2">
                      <a
                        href={getPaymentLink()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-xs font-mono truncate hover:underline text-amber-400"
                      >
                        {getPaymentLink().replace(/^https?:\/\//, "")}
                      </a>
                      <button
                        onClick={copyPaymentLink}
                        className={`p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 ${linkCopied ? "bg-emerald-500/20" : ""}`}
                        title={linkCopied ? "Copied!" : "Copy link"}
                      >
                        {linkCopied ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className={`mb-2 p-2.5 rounded-xl border ${requirePrivatePayments ? "bg-amber-500/10 border-amber-500/30" : "bg-white/5 border-white/10"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-white">🔒 Require Private Payments Only</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          When available, you can require private-only payments.
                        </p>
                      </div>
                      {loadingPreferences ? (
                        <div className="h-5 w-8 rounded-full bg-white/10 animate-pulse shrink-0" />
                      ) : (
                        <Switch
                          checked={requirePrivatePayments}
                          onCheckedChange={handleTogglePrivatePayments}
                          disabled={updatingPreferences}
                          className="shrink-0 data-[state=checked]:bg-amber-500"
                        />
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer buttons */}
          <div className="p-4 pt-3 border-t border-white/10">
            <div className="flex flex-col gap-2">
              {step > 0 && (
                <button
                  onClick={handleBack}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors text-center"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={step === 1 && (checkingAvailability || usernameAvailable === false || !newUsername.trim() || (!usernameFromTwitter && newUsername.length <= LOO_PREFIX.length))}
                className="w-full py-2.5 rounded-xl font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
              >
                {step < 4 ? "Next" : "Get Started"}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <input
                type="checkbox"
                id="dontShowAgain"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500"
              />
              <label htmlFor="dontShowAgain" className="text-xs text-slate-500 cursor-pointer select-none">
                Don&apos;t show this again
              </label>
            </div>
          </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  // Render in portal to body to ensure proper centering
  if (typeof window !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return null;
}
