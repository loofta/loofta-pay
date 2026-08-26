"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Copy, Check, KeyRound, ExternalLink, Trash2, BookOpen, Store } from "lucide-react";
import {
  getSelfServeStatus,
  provisionSelfServeKey,
  revokeSelfServeKey,
  getSelfServeBranding,
  updateSelfServeBranding,
  type SelfServeStatus,
} from "@/services/api/integrators";
import { createPaymentLinkWithKey, type CreatedPaymentLink } from "@/services/api/paymentLinks";

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

type DevTab = "keys" | "branding" | "try";

export default function DeveloperPage() {
  const { authenticated, getAccessToken } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<DevTab>("keys");
  const [status, setStatus] = useState<SelfServeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Raw key is never retrievable from the server after creation — this is only ever a client-side
  // convenience so navigating between tabs, or reloading this page, doesn't force a destructive
  // re-generate (which now revokes the previous key) just to use "Try it" again. sessionStorage
  // (not localStorage) so it still clears itself the moment the tab/browser closes.
  const RAW_KEY_STORAGE_KEY = "loofta-dev-raw-key";
  const [rawKey, setRawKeyState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(RAW_KEY_STORAGE_KEY);
  });
  const setRawKey = useCallback((key: string | null) => {
    setRawKeyState(key);
    if (typeof window === "undefined") return;
    if (key) window.sessionStorage.setItem(RAW_KEY_STORAGE_KEY, key);
    else window.sessionStorage.removeItem(RAW_KEY_STORAGE_KEY);
  }, []);

  const [brandName, setBrandName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  const [demoAmount, setDemoAmount] = useState("25");
  const [demoMessage, setDemoMessage] = useState("Sample payment link");
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoLink, setDemoLink] = useState<CreatedPaymentLink | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

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

  async function handleGenerate() {
    setMinting(true);
    try {
      // Snapshot before minting — refreshStatus() below would otherwise mix the new key in with
      // these, and revoking the just-minted one along with them would be a bug, not a feature.
      const previousKeyIds = (status?.keys ?? []).map((k) => k.id);
      const token = await getAccessToken();
      const minted = await provisionSelfServeKey(token);
      setRawKey(minted.api_key);
      // "Generate" replaces the active key rather than adding to it — one active key at a time is
      // the expectation here. Rotate (below) stays the separate, explicitly non-destructive option
      // for actually overlapping old and new during a real rollout.
      for (const keyId of previousKeyIds) {
        await revokeSelfServeKey(token, keyId).catch(() => {});
      }
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

  async function handleCreateDemoLink() {
    if (!rawKey) return;
    setDemoLoading(true);
    setDemoError(null);
    setDemoLink(null);
    try {
      const amount = Number(demoAmount);
      if (!amount || amount < 1) throw new Error("Minimum is $1.");
      const link = await createPaymentLinkWithKey(rawKey, { amount, message: demoMessage });
      setDemoLink(link);
    } catch (e: any) {
      setDemoError(e?.message || "Could not create payment link");
    } finally {
      setDemoLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-8">
          <p className="text-slate-400 text-center mb-6">Log in to manage your Loofta developer API keys.</p>
          <Link
            href="/"
            className="block w-full text-center rounded-xl px-4 py-3 font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <Link href="/app/profile" className="text-base text-slate-400 hover:text-white mb-4 inline-block">
          ← Settings
        </Link>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-medium text-white mb-2">Developer</h1>
            <p className="text-base text-slate-400">
              Create an API key to build payment links programmatically.
            </p>
          </div>
          <Link
            href="/docs"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
          >
            <BookOpen className="w-4 h-4" />
            Docs
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("keys")}
            className={`px-3 py-2 text-base font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "keys" ? "border-orange-400 text-orange-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            API key
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("branding")}
            className={`px-3 py-2 text-base font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "branding" ? "border-orange-400 text-orange-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            <Store className="w-3.5 h-3.5" />
            Branding
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("try")}
            className={`px-3 py-2 text-base font-medium border-b-2 transition-colors ${activeTab === "try" ? "border-orange-400 text-orange-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            Try it
          </button>
        </div>

        {/* Key management */}
        <div className={`rounded-xl bg-white/5 border border-white/10 p-4 mb-4 ${activeTab === "keys" ? "" : "hidden"}`}>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-base">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
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
                Live (mainnet) — payments move real money. Scoped to creating payment links only.
                At most one active key at a time for now — generating a new one revokes the old.
              </p>
            </>
          )}
        </div>

        {/* Branding — shown on your checkout pages instead of your Loofta username */}
        <div className={`rounded-xl bg-white/5 border border-white/10 p-4 mb-4 ${activeTab === "branding" ? "" : "hidden"}`}>
          <p className="text-base text-slate-400 mb-3">
            Shown on checkout pages for links you create from now on — existing links keep whatever they already had.
          </p>
          {brandLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-base">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-3">
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
        </div>

        {/* Live demo — only once a raw key is in memory this session */}
        <div className={`rounded-xl bg-white/5 border border-white/10 p-4 mb-4 ${activeTab === "try" ? "" : "hidden"}`}>
          <p className="text-lg font-semibold text-slate-100 mb-1">Try it</p>
          <p className="text-base text-slate-400 mb-4">Create a real payment link against your account.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <Link
              href={rawKey ? `/app/demo-store?key=${encodeURIComponent(rawKey)}` : "/app/demo-store"}
              className="block rounded-lg bg-black/20 border border-white/10 p-3 hover:border-orange-400/40 hover:bg-black/30 transition-colors"
            >
              <p className="text-base font-semibold text-orange-400">Demo store →</p>
              <p className="text-base text-slate-400 mt-0.5">See it as a buyer would — one product, one "Buy now" button, a real checkout.</p>
            </Link>
            <Link
              href={rawKey ? `/app/demo?key=${encodeURIComponent(rawKey)}` : "/app/demo"}
              className="block rounded-lg bg-black/20 border border-white/10 p-3 hover:border-orange-400/40 hover:bg-black/30 transition-colors"
            >
              <p className="text-base font-semibold text-orange-400">Pay button config →</p>
              <p className="text-base text-slate-400 mt-0.5">Set amount, message, and webhook by hand, then preview the button.</p>
            </Link>
          </div>
          {!rawKey ? (
            status?.provisioned ? (
              <div className="rounded-lg bg-black/20 border border-white/10 p-3.5 space-y-3">
                <p className="text-base text-slate-300">
                  This browser doesn&apos;t have your raw key anymore — it's kept only for this
                  browser tab and cleared once it's closed, since the server never stores it
                  retrievably after creation.
                </p>
                <div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={minting}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-semibold text-base bg-white/10 text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {minting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Generate a key to use here →
                  </button>
                  <p className="text-base text-slate-400 mt-1.5">Revokes your old key and replaces it with this one.</p>
                </div>
              </div>
            ) : (
              <p className="text-base text-slate-300">Generate a key above first, then come back to try it here.</p>
            )
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-base text-slate-400 mb-1 block">Amount (USD)</label>
                <input
                  type="number"
                  min={1}
                  value={demoAmount}
                  onChange={(e) => setDemoAmount(e.target.value)}
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
                />
              </div>
              <div>
                <label className="text-base text-slate-400 mb-1 block">Message</label>
                <input
                  type="text"
                  value={demoMessage}
                  onChange={(e) => setDemoMessage(e.target.value)}
                  maxLength={1000}
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateDemoLink}
                disabled={demoLoading}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base border border-white/15 text-white hover:bg-white/10 disabled:opacity-50"
              >
                {demoLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create payment link
              </button>
              {demoError && <p className="text-base text-red-400">{demoError}</p>}
              {demoLink && (
                <div className="rounded-lg bg-black/30 border border-white/10 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <code className="text-base text-slate-300 truncate">{demoLink.url}</code>
                    <CopyButton text={demoLink.url} />
                  </div>
                  <a
                    href={demoLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-base text-orange-400 hover:underline"
                  >
                    Open checkout <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick reference */}
        <div className={`rounded-xl bg-white/5 border border-white/10 p-4 ${activeTab === "keys" ? "" : "hidden"}`}>
          <p className="text-base font-semibold text-white mb-2">Quick reference</p>
          <pre className="text-base text-slate-300 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST https://api.loofta.xyz/payment-links \\
  -H "Authorization: Bearer lft_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 25, "message": "Invoice #1042"}'`}
          </pre>
          <p className="text-base text-slate-400 mt-2">
            Full docs, the SDK, and a copyable agent skill: <Link href="/docs" className="text-orange-400 hover:underline">/docs</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
