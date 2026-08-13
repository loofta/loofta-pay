"use client";

import { useState } from "react";
import { usePrivy, useUser, useLinkAccount } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { EMAIL_SKIP_KEY } from "@/components/WelcomeOnboarding";

function isEmailSkipActive(): boolean {
  if (typeof window === "undefined") return false;
  const val = localStorage.getItem(EMAIL_SKIP_KEY);
  if (!val) return false;
  return Date.now() < parseInt(val, 10);
}

/**
 * Nudges authenticated users with no linked email to add one, so they get notified about new
 * payments and gifts. Suppressed while the WelcomeOnboarding modal's own "skip for now" window
 * is active (EMAIL_SKIP_KEY) so the two don't nag back-to-back for the same skip.
 */
export function useAddEmailToast() {
  const { ready, authenticated } = useAuth();
  const { user: privyUser } = usePrivy();
  const { refreshUser } = useUser();
  const [dismissed, setDismissed] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<"already_linked" | null>(null);

  const hasEmail = (privyUser?.linkedAccounts || []).some((a: { type?: string }) => a.type === "email");

  const { linkEmail } = useLinkAccount({
    onSuccess: async (arg: { linkedAccount?: { type?: string }; linkMethod?: string } | undefined) => {
      setLinking(false);
      const isEmail = arg?.linkedAccount?.type === "email" || arg?.linkMethod === "email";
      if (isEmail) {
        setError(null);
        try {
          await refreshUser();
        } catch {
          /* non-critical */
        }
        setDismissed(true);
      }
    },
    onError: (err: unknown) => {
      setLinking(false);
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
      if (/already been linked|already linked|linked to another user/i.test(msg)) {
        setError("already_linked");
      }
    },
  });

  const addEmail = () => {
    setError(null);
    setLinking(true);
    linkEmail();
  };

  const showAddEmail = ready && authenticated && !hasEmail && !dismissed && !isEmailSkipActive();

  return { showAddEmail, addEmail, linking, error, dismiss: () => setDismissed(true) };
}
