"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

interface WelcomeOnboardingProps {
  open: boolean;
  onClose: (dontShowAgain: boolean) => void;
  username: string | null;
  privyUserId?: string;
  onEditUsername?: () => void;
}

export function WelcomeOnboarding({ open, onClose, username, privyUserId, onEditUsername }: WelcomeOnboardingProps) {
  const [step, setStep] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const fullTexts = [
    `Pay your friend\nsend money to @${username || "username"}`,
    "Pay from merchant,\nwithout worrying about network/token",
    "Top up with your favorite\nwallet and token",
    "Welcome to universal\nprivate payment account",
  ];
  
  // Reset step when modal opens
  useEffect(() => {
    if (open) {
      setStep(0);
      setDisplayText("");
      setDontShowAgain(false);
      setNewUsername(username || "");
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingAvailability(false);
    }
  }, [open, username]);

  // Check username availability with debounce
  useEffect(() => {
    if (step !== 1) return; // Only check on step 1
    
    const trimmed = newUsername.trim();
    
    // Reset state if empty
    if (!trimmed) {
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingAvailability(false);
      return;
    }

    // Validate format first
    const validationError = validateUsername(trimmed);
    if (validationError) {
      setUsernameError(validationError);
      setUsernameAvailable(false);
      setCheckingAvailability(false);
      return;
    }

    // If username hasn't changed from current, it's available
    if (trimmed.toLowerCase() === username?.toLowerCase()) {
      setUsernameError(null);
      setUsernameAvailable(true);
      setCheckingAvailability(false);
      return;
    }

    // Debounce the API call
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
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [newUsername, step, username, privyUserId]);

  // Validate username format
  const validateUsername = (value: string): string | null => {
    if (value.length < 3) {
      return "Username must be at least 3 characters";
    }
    if (value.length > 20) {
      return "Username must be 20 characters or less";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return "Username can only contain letters, numbers, and underscores";
    }
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

    // Check if username is available
    if (usernameAvailable === false) {
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

    // Only show typing animation for steps 2, 3, 4, 5 (not 0, 1)
    if (step < 2) {
      setDisplayText("");
      return;
    }

    const textIndex = step - 2; // Map step 2->0, 3->1, 4->2, 5->3
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

    if (step < 5) {
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
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden"
        >
          {/* Progress bar */}
          <div className="flex gap-1.5 p-4 pb-0">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <motion.div
                  className="h-full"
                  style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
                  initial={{ width: 0 }}
                  animate={{ width: step >= i ? "100%" : "0%" }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="relative h-[420px] overflow-hidden">
            {/* Step 0: Welcome */}
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
                  >
                    <div
                      className="w-24 h-24 rounded-full flex items-center justify-center mx-auto"
                      style={{
                        background: "linear-gradient(135deg, rgba(255,15,0,0.15) 0%, rgba(234,179,8,0.15) 100%)",
                      }}
                    >
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-orange-500">
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
                    className="text-3xl font-bold text-gray-900 mb-3"
                  >
                    Welcome to Loofta Pay!
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-lg text-gray-600 mb-2"
                  >
                    Your universal private payment account
                  </motion.p>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-sm text-gray-500"
                  >
                    Pay & receive crypto privately
                  </motion.p>
                </motion.div>
              )}

              {/* Step 1: Edit username */}
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
                  >
                    <div className="text-6xl mb-4">✏️</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gray-900 mb-4"
                  >
                    Start editing your unique username
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-base text-gray-600 mb-6"
                  >
                    to receive payment from any chain, any token
                  </motion.p>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 }}
                    className="flex flex-col items-center gap-3 w-full max-w-xs"
                  >
                    <div className="w-full space-y-3">
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-lg">
                          @
                        </div>
                        <input
                          type="text"
                          value={newUsername}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
                            setNewUsername(value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleNext();
                            }
                          }}
                          placeholder="username"
                          className={`w-full pl-8 pr-4 py-3 rounded-xl border-2 text-lg font-semibold text-center transition-colors ${
                            checkingAvailability
                              ? "border-gray-300"
                              : usernameAvailable === true
                              ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                              : usernameAvailable === false
                              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                              : "border-orange-300 focus:border-orange-500 focus:ring-orange-500"
                          } focus:outline-none focus:ring-2`}
                          autoFocus
                          maxLength={20}
                        />
                        {checkingAvailability && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                        {!checkingAvailability && usernameAvailable === true && newUsername.trim() && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {!checkingAvailability && usernameAvailable === false && newUsername.trim() && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                        )}
                      </div>
                      {usernameError && (
                        <p className="text-sm text-red-600 text-center">{usernameError}</p>
                      )}
                      {!usernameError && checkingAvailability && newUsername.trim() && (
                        <p className="text-sm text-gray-500 text-center">Checking availability...</p>
                      )}
                      {!usernameError && !checkingAvailability && usernameAvailable === true && newUsername.trim() && (
                        <p className="text-sm text-green-600 text-center">✓ Username available</p>
                      )}
                      <p className="text-xs text-gray-500 text-center">
                        3-20 characters, letters, numbers, and underscores only
                      </p>
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
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
                  >
                    <div className="text-6xl mb-4">💸</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gray-900 mb-6 min-h-[80px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[0].length && (
                      <span className="animate-pulse">|</span>
                    )}
                  </motion.h2>
                </motion.div>
              )}

              {/* Step 3: Pay merchant */}
              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
                  >
                    <div className="text-6xl mb-4">🛒</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gray-900 mb-6 min-h-[80px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[1].length && (
                      <span className="animate-pulse">|</span>
                    )}
                  </motion.h2>
                </motion.div>
              )}

              {/* Step 4: Top up */}
              {step === 4 && (
                <motion.div
                  key="step4"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
                  >
                    <div className="text-6xl mb-4">💳</div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gray-900 mb-6 min-h-[80px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[2].length && (
                      <span className="animate-pulse">|</span>
                    )}
                  </motion.h2>
                </motion.div>
              )}

              {/* Step 5: Final welcome */}
              {step === 5 && (
                <motion.div
                  key="step5"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mb-6"
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
                        🎉
                      </motion.div>
                    </div>
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold text-gray-900 mb-6 min-h-[80px] whitespace-pre-line"
                  >
                    {displayText.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < displayText.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                    {displayText.length < fullTexts[3].length && (
                      <span className="animate-pulse">|</span>
                    )}
                  </motion.h2>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer buttons */}
          <div className="p-6 pt-4 border-t border-gray-200">
            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              {/* Back button - above Next */}
              {step > 1 && (
                <button
                  onClick={handleBack}
                  className="text-sm text-gray-500 hover:text-gray-700 transition-colors text-center"
                >
                  Back
                </button>
              )}
              
              {/* Next button */}
              <button
                onClick={handleNext}
                disabled={step === 1 && (checkingAvailability || usernameAvailable === false || !newUsername.trim())}
                className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
              >
                {step < 5 ? "Next" : "Get Started"}
              </button>
            </div>
            
            {/* Don't show again checkbox - below buttons */}
            <div className="mt-4 flex items-center justify-center gap-2">
              <input
                type="checkbox"
                id="dontShowAgain"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500 focus:ring-2"
              />
              <label
                htmlFor="dontShowAgain"
                className="text-sm text-gray-600 cursor-pointer select-none"
              >
                Don't show this again
              </label>
            </div>
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
}
