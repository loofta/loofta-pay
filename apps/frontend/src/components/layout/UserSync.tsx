'use client'

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UsernameSetupModal } from "@/components/UsernameSetupModal";
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";

/**
 * Syncs authenticated user to store (username) and shows username/onboarding modals.
 * Renders no UI; keeps auth state and username/onboarding modals working alongside MinimalHeader.
 */
export function UserSync() {
  const { authenticated, email, userId } = useAuth();
  const { user: privyUser, ready: privyReady } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const setUsername = useAuthStore((s) => s.setUsername);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showWelcomeOnboarding, setShowWelcomeOnboarding] = useState(false);
  /** Avoid re-opening welcome modal when Privy refreshes `user` (fixes flicker / “stuck” after skip). */
  const welcomeDismissedRef = useRef(false);

  const welcomeSessionDismissedKey = (uid: string) => `loofta_welcome_onboarding_dismissed_${uid}`;

  // Check user and set username from backend
  useEffect(() => {
    if (!authenticated || !userId) {
      setUsername(null);
      return;
    }

    const checkUser = async () => {
      try {
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privyUserId: userId, email }),
        });
        const userData = await userResponse.json();

        if (userData.user) {
          const usernameValue = userData.user.username || null;
          setUsername(usernameValue);
          if (userData.user.email) {
            setAuth({
              authenticated: true,
              userId,
              email: userData.user.email,
              username: usernameValue,
            });
          }
          // Onboarding (add-email, then welcome flow) shows after login; no separate username modal
        }
      } catch (error) {
        console.error("[UserSync] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email, setUsername, setAuth]);

  useEffect(() => {
    if (!authenticated || !userId) {
      welcomeDismissedRef.current = false;
      return;
    }
    welcomeDismissedRef.current =
      typeof window !== "undefined" &&
      sessionStorage.getItem(welcomeSessionDismissedKey(userId)) === "1";
  }, [authenticated, userId]);

  // Show onboarding right after login (add-email, then welcome flow). Don't wait for Solana wallet.
  useEffect(() => {
    if (!authenticated || !privyReady || !privyUser || !userId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        if (typeof window !== "undefined" && sessionStorage.getItem(welcomeSessionDismissedKey(userId)) === "1") {
          welcomeDismissedRef.current = true;
          return;
        }
        if (welcomeDismissedRef.current) return;

        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privyUserId: userId, email }),
        });
        const userData = await userResponse.json();
        if (cancelled || userData.user?.skipOnboarding) return;
        if (welcomeDismissedRef.current) return;

        timer = setTimeout(() => {
          if (!cancelled && !welcomeDismissedRef.current) setShowWelcomeOnboarding(true);
        }, 600);
      } catch (error) {
        console.error("[UserSync] Error checking onboarding:", error);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, userId, email, privyReady, privyUser?.id]);

  const refreshUser = async () => {
    if (!authenticated || !userId) return;
    try {
      const r = await fetch("/api/users/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privyUserId: userId, email }),
      });
      const data = await r.json();
      if (data.user?.username) setUsername(data.user.username);
    } catch (e) {
      console.error("[UserSync] Error refreshing user:", e);
    }
  };

  return (
    <>
      {userId && (
        <UsernameSetupModal
          open={showUsernameModal}
          onClose={() => setShowUsernameModal(false)}
          onSuccess={(newUsername) => {
            setUsername(newUsername);
            setShowUsernameModal(false);
          }}
          privyUserId={userId}
        />
      )}
      {userId && (
        <WelcomeOnboarding
          open={showWelcomeOnboarding}
          onClose={(_dontShowAgain) => {
            welcomeDismissedRef.current = true;
            if (typeof window !== "undefined") {
              try {
                sessionStorage.setItem(welcomeSessionDismissedKey(userId), "1");
              } catch {
                /* ignore quota / private mode */
              }
            }
            setShowWelcomeOnboarding(false);
            queueMicrotask(() => {
              void refreshUser();
            });
          }}
          username={username ?? null}
          privyUserId={userId}
          onEditUsername={refreshUser}
        />
      )}
    </>
  );
}
