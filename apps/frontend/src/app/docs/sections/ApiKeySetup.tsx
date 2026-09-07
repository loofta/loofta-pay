"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Copy, Check, KeyRound, Trash2, Store } from "lucide-react";
import {
  getSelfServeStatus,
  provisionSelfServeKey,
  revokeSelfServeKey,
  getSelfServeBranding,
  updateSelfServeBranding,
  type SelfServeStatus,
} from "@/services/api/integrators";

// Shared with TryIt.tsx (../sections/TryIt.tsx reads the same key on mount) — this is the only
// hand-off between the two docs sections, so a freshly generated key is ready to use over there
// without threading it through docs/page.tsx's own state.
export const RAW_KEY_STORAGE_KEY = "loofta-dev-raw-key";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white shrink-0 transition-colors"
      aria-label="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ApiKeySetup({ onNavigate }: { onNavigate: (slug: string) => void }) {
  const { authenticated, getAccessToken, login } = useAuth();
  const { toast } = useToast();

  const [status, setStatus] = useState<SelfServeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Raw key is never retrievable from the server after creation — this is only ever a client-side
  // convenience so navigating between docs sections, reloading, or coming back in a new tab
  // tomorrow doesn't force a destructive re-generate (which revokes the previous key) just to use
  // Try It again. localStorage rather than sessionStorage — a self-serve dev key someone is
  // actively testing against is worth surviving a closed tab; they can still revoke it above.
  const [rawKey, setRawKeyState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(RAW_KEY_STORAGE_KEY);
  });
  const setRawKey = useCallback((key: string | null) => {
    setRawKeyState(key);
    if (typeof window === "undefined") return;
    if (key) window.localStorage.setItem(RAW_KEY_STORAGE_KEY, key);
    else window.localStorage.removeItem(RAW_KEY_STORAGE_KEY);
  }, []);

  const [brandName, setBrandName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!authenticated) return;
    setStatusLoading(true);
    try {
      const token = await getAccessToken();
      setStatus(await getSelfServeStatus(token));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not load API keys", description: e?.message });
    } finally {
      setStatusLoading(false);
    }
  }, [authenticated, getAccessToken, toast]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      setBrandLoading(true);
      try {
        const token = await getAccessToken();
        const branding = await getSelfServeBranding(token);
        setBrandName(branding.name ?? "");
        setBrandLogoUrl(branding.logo_url ?? "");
      } catch {
        // No branding set yet — leave fields blank rather than surfacing an error.
      } finally {
        setBrandLoading(false);
      }
    })();
  }, [authenticated, getAccessToken]);

  async function handleGenerate() {
    setMinting(true);
    try {
      // "Generate" replaces the active key rather than adding to it — provisionSelfServeKey
      // itself revokes any existing key server-side before minting the new one (atomic, no
      // separate frontend revoke round-trip that would re-revoke an already-revoked key and
      // delay refreshStatus() below).
      const token = await getAccessToken();
      const minted = await provisionSelfServeKey(token);
      setRawKey(minted.api_key);
      await refreshStatus();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not generate key", description: e?.message });
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId);
    try {
      const token = await getAccessToken();
      await revokeSelfServeKey(token, keyId);
      // Only one active key can exist at a time now, so revoking always invalidates whatever raw
      // value is held here — never leave a now-dead key sitting around looking usable.
      setRawKey(null);
      await refreshStatus();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not revoke key", description: e?.message });
    } finally {
      setRevokingId(null);
    }
  }

  async function handleSaveBranding() {
    setBrandSaving(true);
    try {
      const token = await getAccessToken();
      const saved = await updateSelfServeBranding(token, {
        name: brandName.trim() || undefined,
        logo_url: brandLogoUrl.trim() || undefined,
      });
      setBrandName(saved.name ?? "");
      setBrandLogoUrl(saved.logo_url ?? "");
      toast({ title: "Branding saved" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not save branding", description: e?.message });
    } finally {
      setBrandSaving(false);
    }
  }

  async function handleLogoFile(file: File) {
    setLogoUploadError(null);
    setLogoUploading(true);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/merchant-branding/upload-logo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setBrandLogoUrl(data.logo_url);
    } catch (e: any) {
      setLogoUploadError(e?.message || "Could not upload logo");
    } finally {
      setLogoUploading(false);
    }
  }

  if (!authenticated) {
    return (
      <article>
        <h1 className="text-3xl font-medium text-slate-100 mb-3">API key &amp; branding</h1>
        <p className="text-base text-slate-400 leading-relaxed mb-6">
          Generate a live API key to create payment links programmatically, and set the business
          name and logo shown on your checkout pages.
        </p>
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
          <p className="text-base text-slate-300 mb-4">Log in to generate a key.</p>
          <button
            type="button"
            onClick={() => login()}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
          >
            Log in
          </button>
        </div>
      </article>
    );
  }

  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">API key &amp; branding</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Generate a live API key to create payment links programmatically, and set the business
        name and logo shown on your checkout pages.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Your key</h2>
      {statusLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-base mb-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6">
          {status?.keys.length ? (
            <div className="space-y-2 mb-3">
              {status.keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/30 border border-white/10 px-3 py-2">
                  <code className="text-base text-slate-300 truncate">{k.key_prefix}…</code>
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    disabled={revokingId === k.id}
                    className="p-1.5 rounded hover:bg-red-500/15 text-slate-400 hover:text-red-400 shrink-0 transition-colors disabled:opacity-50"
                    aria-label="Revoke"
                  >
                    {revokingId === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-base text-slate-300 mb-3">No API key yet.</p>
          )}

          {rawKey && (
            <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-400/30 p-3">
              <p className="text-base font-medium text-amber-200 mb-1.5">Save this now — shown only once</p>
              <div className="flex items-center justify-between gap-2 rounded-md bg-black/40 px-2.5 py-2">
                <code className="text-base text-white truncate">{rawKey}</code>
                <CopyButton text={rawKey} />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={minting}
            title={status?.keys.length ? "Revokes your current key immediately and mints a new one in its place" : undefined}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-50"
          >
            {minting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {status?.keys.length ? "Generate new key" : "Generate API key"}
          </button>
          <p className="text-base text-slate-400 mt-2">
            Live (mainnet) — payments move real money. Scoped to creating payment links only. At
            most one active key at a time for now — generating a new one revokes the old.
          </p>
        </div>
      )}

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Branding</h2>
      <p className="text-base text-slate-400 mb-3">
        Shown on checkout pages for links you create from now on — existing links keep whatever
        they already had.
      </p>
      {brandLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-base mb-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6 space-y-3">
          <div>
            <label className="text-base text-slate-400 mb-1 block">Business name</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Your business name"
              maxLength={200}
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
            />
          </div>
          <div>
            <label className="text-base text-slate-400 mb-1 block">Logo</label>
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full overflow-hidden bg-black/30 border border-white/10 shrink-0 flex items-center justify-center">
                {brandLogoUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element -- server-cropped square, but not a local/optimizable asset
                  <img
                    src={brandLogoUrl.trim()}
                    alt="Logo preview"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <Store className="w-5 h-5 text-slate-500" />
                )}
              </div>
              <label className="flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium text-base border border-white/15 text-slate-300 hover:bg-white/10 cursor-pointer disabled:opacity-50">
                {logoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {logoUploading ? "Uploading…" : brandLogoUrl.trim() ? "Change logo" : "Upload logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={logoUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) handleLogoFile(file);
                  }}
                />
              </label>
            </div>
            <p className="text-base text-slate-400 mt-1.5">Any image works — we crop it to a circle for you.</p>
            {logoUploadError && <p className="text-base text-red-400 mt-1">{logoUploadError}</p>}
          </div>
          <button
            type="button"
            onClick={handleSaveBranding}
            disabled={brandSaving}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-white/15 text-white hover:bg-white/10 disabled:opacity-50"
          >
            {brandSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save branding
          </button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Next:{" "}
          <button type="button" onClick={() => onNavigate("try-it")} className="text-orange-400 hover:underline">
            try it
          </button>{" "}
          with a real payment link.
        </p>
      </div>
    </article>
  );
}
