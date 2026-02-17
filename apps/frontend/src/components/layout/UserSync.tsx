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
          if (userData.needsUsername) {
            setShowUsernameModal(true);
          }
        }
      } catch (error) {
        console.error("[UserSync] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email, setUsername, setAuth]);

  // Show welcome onboarding when username + Solana wallet ready
  useEffect(() => {
    if (!authenticated || !username || !privyReady || !privyUser || !userId || showUsernameModal) {
      return;
    }

    const checkOnboarding = async () => {
      try {
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privyUserId: userId, email }),
        });
        const userData = await userResponse.json();
        if (userData.user?.skipOnboarding) return;

        const linkedAccounts = privyUser?.linkedAccounts || [];
        const linkedWallets = linkedAccounts.filter(
          (account: any) => account.type === "wallet" || account.type === "smart_wallet"
        );
        const solanaWallet = linkedWallets.find((account: any) => {
          const address = account?.address;
          return address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
        });

        if (username && solanaWallet?.address) {
          const timer = setTimeout(() => setShowWelcomeOnboarding(true), 1500);
          return () => clearTimeout(timer);
        }
      } catch (error) {
        console.error("[UserSync] Error checking onboarding:", error);
      }
    };

    checkOnboarding();
  }, [authenticated, username, userId, email, privyUser, privyReady, showUsernameModal]);

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
      {username && userId && (
        <WelcomeOnboarding
          open={showWelcomeOnboarding}
          onClose={(_dontShowAgain) => {
            setShowWelcomeOnboarding(false);
            refreshUser();
          }}
          username={username}
          privyUserId={userId}
          onEditUsername={refreshUser}
        />
      )}
    </>
  );
}
