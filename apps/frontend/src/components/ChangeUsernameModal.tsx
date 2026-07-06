"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";

const LOO_PREFIX = "loo-";

interface ChangeUsernameModalProps {
  open: boolean;
  onClose: () => void;
  currentUsername: string | null;
  storeLooUsername: string | null;
  storeTwitterUsername: string | null;
  onSaved: (username: string, looUsername: string | null, twitterUsername: string | null) => void;
}

export function ChangeUsernameModal({
  open,
  onClose,
  currentUsername,
  storeLooUsername,
  storeTwitterUsername,
  onSaved,
}: ChangeUsernameModalProps) {
  const { getAccessToken } = usePrivy();

  const usingTwitter = !!storeTwitterUsername && currentUsername?.toLowerCase() === storeTwitterUsername.toLowerCase();

  const initialSuffix = storeLooUsername?.startsWith(LOO_PREFIX)
    ? storeLooUsername.slice(LOO_PREFIX.length)
    : "";

  const [suffix, setSuffix] = useState(initialSuffix);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSuffix(initialSuffix);
      setAvailable(null);
      setError(null);
    }
  }, [open]);

  // Debounced availability check
  useEffect(() => {
    if (!open || usingTwitter) return;
    const trimmed = suffix.trim();
    if (!trimmed || trimmed === initialSuffix) {
      setAvailable(trimmed === initialSuffix ? true : null);
      setError(null);
      return;
    }
    const candidate = LOO_PREFIX + trimmed;
    setAvailable(null);
    setError(null);
    const id = setTimeout(async () => {
      setChecking(true);
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch("/api/users/check-username", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ username: candidate }),
        });
        const data = await res.json();
        setAvailable(!!data.available);
        if (!data.available) setError(data.error || "Username not available");
      } catch {
        setAvailable(false);
        setError("Failed to check availability");
      } finally {
        setChecking(false);
      }
    }, 500);
    return () => clearTimeout(id);
  }, [suffix, open, usingTwitter]);

  const canSave =
    !usingTwitter &&
    suffix.trim().length >= 1 &&
    suffix.length <= 16 &&
    /^[a-zA-Z0-9_]+$/.test(suffix) &&
    available === true &&
    !checking;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const username = (LOO_PREFIX + suffix.trim()).toLowerCase();
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/users/setup-username", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save username");
        return;
      }
      onSaved(
        data.user?.username ?? username,
        data.user?.looUsername ?? username,
        data.user?.twitterUsername ?? null
      );
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to save username");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0f0f12] border-t border-white/10 sm:border sm:rounded-2xl w-full sm:max-w-sm shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white mb-1">Change username</h2>
        <p className="text-sm text-slate-400 mb-5">
          Your payment link is <span className="text-white font-medium">pay.loofta.xyz/me/@{currentUsername ?? "…"}</span>
        </p>

        {usingTwitter ? (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 mb-5">
            <p className="text-sm text-amber-300">
              You&apos;re using your X handle as your payment link. Switch to your{" "}
              <span className="font-semibold">loo-</span> username first to edit it.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-5">
            <div
              className={`flex items-center rounded-xl border px-3 py-2.5 bg-white/5 ${
                checking
                  ? "border-white/20"
                  : available === true
                  ? "border-emerald-500/60"
                  : available === false
                  ? "border-red-500/60"
                  : "border-white/20"
              }`}
            >
              <span className="text-slate-500 font-semibold shrink-0">@</span>
              <span className="text-slate-400 font-medium shrink-0 ml-0.5">{LOO_PREFIX}</span>
              <input
                type="text"
                value={suffix}
                onChange={(e) => {
                  setSuffix(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16));
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && canSave) handleSave(); }}
                placeholder={initialSuffix || "yourname"}
                autoFocus
                className="flex-1 min-w-0 bg-transparent border-0 py-0 ml-0.5 text-white placeholder:text-slate-600 font-medium focus:ring-0 focus:outline-none"
              />
              {checking && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin shrink-0" />}
              {!checking && available === true && suffix.trim() && (
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!checking && available === false && suffix.trim() && (
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <p className="text-sm text-slate-600">1–16 letters, numbers, or underscores after loo-</p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!error && available === true && suffix.trim() !== initialSuffix && (
              <p className="text-sm text-emerald-400">Username available</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl font-medium text-slate-400 hover:text-white border border-white/10 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {!usingTwitter && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex-1 py-2.5 rounded-xl font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(to right, #FF1301, #EAB308)" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof window !== "undefined") return createPortal(modal, document.body);
  return null;
}
