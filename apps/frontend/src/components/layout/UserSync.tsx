'use client'

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { useAuthStore } from "@/store/auth";
import { UsernameSetupModal } from "@/components/UsernameSetupModal";
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";

/**
 * Syncs authenticated user to store (username) and shows username/onboarding modals.
 * Renders no UI; keeps auth state and username/onboarding modals working alongside MinimalHeader.
 */
export function UserSync({ suppressOnboarding = false }: { suppressOnboarding?: boolean } = {}) {
  const { authenticated, email, userId, getAccessToken } = useAuth();
  const { user: privyUser, ready: privyReady } = usePrivy();
  const { createWallet } = useCreateWallet();
  const username = useAuthStore((s) => s.username ?? null);
  const setUsername = useAuthStore((s) => s.setUsername);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setLooUsername = useAuthStore((s) => s.setLooUsername);
  const setTwitterUsername = useAuthStore((s) => s.setTwitterUsername);
  const setAvatarUrl = useAuthStore((s) => s.setAvatarUrl);
  const setAtaMigrated = useAuthStore((s) => s.setAtaMigrated);
  const isOnboardingOpen = useAuthStore((s) => s.isOnboardingOpen);
  const setIsOnboardingOpen = useAuthStore((s) => s.setIsOnboardingOpen);
  const walletCreatedRef = useRef(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showWelcomeOnboarding, setShowWelcomeOnboarding] = useState(false);
  /** Avoid re-opening welcome modal when Privy refreshes `user` (fixes flicker / “stuck” after skip). */
  const welcomeDismissedRef = useRef(false);

  const welcomeSessionDismissedKey = (uid: string) => `loofta_welcome_onboarding_dismissed_${uid}`;
  const welcomePermanentDismissedKey = (uid: string) => `loofta_onboarding_done_${uid}`;

  // Ensure the user has a Solana embedded wallet. Privy's createOnLogin config handles new logins,
  // but users who signed up before Solana wallets were enabled land here with no wallet.
  useEffect(() => {
    if (!privyReady || !authenticated || !privyUser) return;
    if (walletCreatedRef.current) return;
    const hasSolanaWallet = !!deriveSolanaEmbeddedAddress(privyUser);
    if (hasSolanaWallet) return;
    walletCreatedRef.current = true;
    createWallet().catch((e) => {
      // Non-fatal: wallet may already exist or creation may be in progress
      console.warn("[UserSync] Could not create Solana embedded wallet:", e?.message ?? e);
      walletCreatedRef.current = false;
    });
  }, [privyReady, authenticated, privyUser, createWallet]);

  // Check user and set username from backend
  useEffect(() => {
    if (!authenticated || !userId) {
      setUsername(null);
      return;
    }
    // Wait for Privy to actually be ready. On a full page refresh, `authenticated`/`userId`
    // come back true immediately from the persisted zustand store (useAuth deliberately
    // returns cached auth state before Privy's client finishes initializing, to avoid
    // flicker) — but getAccessToken() isn't reliable yet at that point. If this effect fired
    // anyway, the fetch below goes out with no Authorization header, the backend 401s,
    // `userData.user` comes back undefined, and the whole sync silently no-ops — leaving
    // the stale persisted username on screen for the rest of the session, since nothing
    // else re-triggers this effect (none of its other deps change on their own).
    if (!privyReady) return;

    const checkUser = async () => {
      try {
        // privyReady doesn't strictly guarantee getAccessToken() resolves to a real token on
        // the very first call right after it flips true — retry rather than silently leaving
        // the stale persisted username on screen for the rest of the session if it doesn't.
        let userData: { user?: Record<string, unknown> } | null = null;
        for (const attempt of [0, 500, 1500]) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, attempt));
          const token = await getAccessToken();
          if (!token) continue;
          const userResponse = await fetch("/api/users/check", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ email }),
          });
          if (!userResponse.ok) continue;
          userData = await userResponse.json();
          if (userData?.user) break;
        }

        if (userData?.user) {
          const usernameValue = (userData.user.username as string | null) || null;
          setUsername(usernameValue);
          setLooUsername((userData.user.looUsername as string | null) ?? null);
          setTwitterUsername((userData.user.twitterUsername as string | null) ?? null);
          setAvatarUrl((userData.user.avatarUrl as string | null) ?? null);
          setAtaMigrated("mainnet", (userData.user.ataMigratedMainnet as boolean) ?? false);
          setAtaMigrated("devnet", (userData.user.ataMigratedDevnet as boolean) ?? false);
          if (userData.user.email) {
            setAuth({
              authenticated: true,
              userId,
              email: userData.user.email as string,
              username: usernameValue,
              looUsername: (userData.user.looUsername as string | null) ?? null,
              twitterUsername: (userData.user.twitterUsername as string | null) ?? null,
              avatarUrl: (userData.user.avatarUrl as string | null) ?? null,
            });
          }
          // Onboarding (add-email, then welcome flow) shows after login; no separate username modal
        }
      } catch (error) {
        console.error("[UserSync] Error checking user:", error);
      }
    };

    checkUser();
  }, [authenticated, userId, email, privyReady, setUsername, setAuth]);

  useEffect(() => {
    if (!authenticated || !userId) {
      welcomeDismissedRef.current = false;
      return;
    }
    welcomeDismissedRef.current =
      typeof window !== "undefined" &&
      (sessionStorage.getItem(welcomeSessionDismissedKey(userId)) === "1" ||
        localStorage.getItem(welcomePermanentDismissedKey(userId)) === "1");
  }, [authenticated, userId]);

  // Allow external callers (e.g. "Change username" in settings) to re-open onboarding via store flag
  useEffect(() => {
    if (suppressOnboarding) return;
    if (isOnboardingOpen && !showWelcomeOnboarding) {
      welcomeDismissedRef.current = false;
      setShowWelcomeOnboarding(true);
    }
  }, [isOnboardingOpen, suppressOnboarding]);

  // Show onboarding right after login (add-email, then welcome flow). Don't wait for Solana wallet.
  // Skipped entirely on checkout (suppressOnboarding) — a payer on someone else's payment link
  // should never see Loofta's own new-user onboarding. Wallet creation and username assignment
  // above still run unconditionally; ensureAppUser on the backend already assigns a username with
  // no interactive step (see users.service.ts), so paying isn't blocked by skipping this modal.
  useEffect(() => {
    if (suppressOnboarding) return;
    if (!authenticated || !privyReady || !privyUser || !userId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        // Fastest gate: localStorage is permanent and device-local — check before any network call.
        // Users who completed onboarding (current or any prior session on this device) stop here.
        if (typeof window !== "undefined") {
          if (
            localStorage.getItem(welcomePermanentDismissedKey(userId)) === "1" ||
            sessionStorage.getItem(welcomeSessionDismissedKey(userId)) === "1"
          ) {
            welcomeDismissedRef.current = true;
            return;
          }
        }

        const token = await getAccessToken();
        const userResponse = await fetch("/api/users/check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ email }),
        });
        const userData = await userResponse.json();
        if (cancelled || userData.user?.skipOnboarding) return;

        const isNewUser = userData.exists === false;
        // Returning users with a username already set have already been through onboarding
        if (!isNewUser && userData.user?.username) return;

        // New users always see onboarding — bypass all dismissal caches
        if (!isNewUser) {
          if (welcomeDismissedRef.current) return;
        }

        timer = setTimeout(() => {
          if (!cancelled) {
            welcomeDismissedRef.current = false;
            setShowWelcomeOnboarding(true);
            setIsOnboardingOpen(true);
          }
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
  }, [authenticated, userId, email, privyReady, privyUser?.id, suppressOnboarding]);

  const refreshUser = async () => {
    if (!authenticated || !userId) return;
    try {
      const token = await getAccessToken();
      const r = await fetch("/api/users/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (data.user?.username) setUsername(data.user.username);
      if (data.user?.looUsername !== undefined) setLooUsername(data.user.looUsername ?? null);
      if (data.user?.twitterUsername !== undefined) setTwitterUsername(data.user.twitterUsername ?? null);
      if (data.user?.avatarUrl !== undefined) setAvatarUrl(data.user.avatarUrl ?? null);
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
      {userId && !suppressOnboarding && (
        <WelcomeOnboarding
          open={showWelcomeOnboarding}
          onClose={() => {
            welcomeDismissedRef.current = true;
            if (typeof window !== "undefined") {
              try {
                sessionStorage.setItem(welcomeSessionDismissedKey(userId), "1");
                localStorage.setItem(welcomePermanentDismissedKey(userId), "1");
              } catch {
                /* ignore quota / private mode */
              }
            }
            setShowWelcomeOnboarding(false);
            setIsOnboardingOpen(false);
            queueMicrotask(() => {
              void refreshUser();
            });
          }}
          username={username ?? null}
          privyUserId={userId}
          onUsernameSaved={(newUsername, looUsername, twitterUsername) => {
            setUsername(newUsername);
            if (looUsername !== undefined) setLooUsername(looUsername ?? null);
            if (twitterUsername !== undefined) setTwitterUsername(twitterUsername ?? null);
          }}
        />
      )}
    </>
  );
}
