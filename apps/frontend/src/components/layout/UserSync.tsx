'use client'

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UsernameSetupModal } from "@/components/UsernameSetupModal";
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";

/**
 * Syncs authenticated user to store (username) and shows username/onboarding modals.
 * Renders no UI; used when Header is removed so auth state and modals still work.
 */
export function UserSync() {
  const { authenticated, email, userId } = useAuth();
  const { user: privyUser, ready: privyReady } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const setUsername = useAuthStore((s) => s.setUsername);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showWelcomeOnboarding, setShowWelcomeOnboarding] = useState(false);

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
          // Onboarding (add-email, add-Twitter, username step) shows after login; no separate username modal
        }
      } catch (error) {
        console.error("[UserSync] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email, setUsername, setAuth]);

  // Show onboarding right after login (add-email, add-Twitter, then username step). Don't wait for Solana wallet.
  useEffect(() => {
    if (!authenticated || !privyReady || !privyUser || !userId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privyUserId: userId, email }),
        });
        const userData = await userResponse.json();
        if (cancelled || userData.user?.skipOnboarding) return;

        timer = setTimeout(() => {
          if (!cancelled) setShowWelcomeOnboarding(true);
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
  }, [authenticated, userId, email, privyUser, privyReady]);

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
            setShowWelcomeOnboarding(false);
            refreshUser();
          }}
          username={username ?? null}
          privyUserId={userId}
          onEditUsername={refreshUser}
        />
      )}
    </>
  );
}
