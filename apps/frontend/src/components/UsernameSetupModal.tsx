"use client";

import { useState, useMemo, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

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

interface UsernameSetupModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
  privyUserId: string;
}

export function UsernameSetupModal({
  open,
  onClose,
  onSuccess,
  privyUserId,
}: UsernameSetupModalProps) {
  const { user: privyUser, getAccessToken } = usePrivy();
  const twitterUsername = useMemo(
    () => getTwitterUsername(privyUser?.linkedAccounts as Array<{ type?: string; username?: string; name?: string; subject?: string }> | undefined),
    [privyUser?.linkedAccounts]
  );
  const [looSuffix, setLooSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setLooSuffix("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const username = twitterUsername ? twitterUsername.trim() : (LOO_PREFIX + looSuffix.trim()).toLowerCase();
    if (!username) {
      setError("Sign in with Twitter to get your payment link, or choose a name after loo-.");
      return;
    }
    if (!twitterUsername && looSuffix.trim().length < 1) {
      setError("Choose at least 1 character after loo-.");
      return;
    }
    if (!twitterUsername && (looSuffix.length > 16 || !/^[a-zA-Z0-9_]+$/.test(looSuffix))) {
      setError("After loo- use 1–16 letters, numbers, and underscores only.");
      return;
    }
    if (!twitterUsername && looSuffix.trim().toLowerCase().startsWith("skr-")) {
      setError("The skr- prefix is reserved for Seeker device logins.");
      return;
    }

    setLoading(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const response = await fetch("/api/users/setup-username", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to set username");
      }

      onSuccess(data.user.username);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to set username. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const hasTwitter = !!twitterUsername;
  const canSubmitLoo = !hasTwitter && looSuffix.trim().length >= 1 && looSuffix.length <= 16 && /^[a-zA-Z0-9_]*$/.test(looSuffix);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {hasTwitter ? "Your username is your Twitter handle" : "Choose your username"}
          </h2>
          <p className="text-gray-600 mb-6 text-base md:text-sm">
            {hasTwitter
              ? "Your payment link uses your Twitter username. It can't be changed."
              : "Your link will be @loo-yourname. The loo- part can't be changed. Add Twitter later to get @yourhandle."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-base md:text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              {hasTwitter ? (
                <input
                  id="username"
                  type="text"
                  value={twitterUsername ?? ""}
                  readOnly
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 cursor-default"
                  aria-label="Twitter username"
                />
              ) : (
                <div className="flex items-center rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 gap-0.5">
                  <span className="text-gray-500 font-medium shrink-0">@</span>
                  <span className="text-gray-600 font-medium shrink-0">{LOO_PREFIX}</span>
                  <input
                    id="username"
                    type="text"
                    value={looSuffix}
                    onChange={(e) => setLooSuffix(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16))}
                    placeholder="yourname"
                    className="flex-1 min-w-0 bg-transparent border-0 py-0 pl-0.5 text-gray-900 placeholder:text-gray-400 focus:ring-0 focus:outline-none"
                    aria-label="Username suffix after loo-"
                  />
                </div>
              )}
              {!hasTwitter && (
                <p className="mt-1 text-sm text-gray-500">1–16 letters, numbers, underscores after loo-</p>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-base md:text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || (hasTwitter ? false : !canSubmitLoo)}
                className="flex-1 font-semibold text-white border-0"
                style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)" }}
              >
                {loading ? "Setting up..." : "Continue"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
