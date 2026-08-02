"use client";

// Self-serve business dashboard: create an organization (lands pending admin approval),
// configure branding/payout wallet+token, and mint an API key once approved. Payout token/chain
// selection mirrors the config-panel pattern from the original loofta-pay-sdk b2b demo (any
// token via TokenCombobox) — wired here into the real burner+DepositService checkout flow
// (see ClaimsService.createForOrganizationCheckout) instead of that demo's direct/no-privacy one,
// so a Solana payout still gets the private-transfer option.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Loader2, Copy, Check, Building2, Plus, Wallet, AlertTriangle, Moon, Sun } from "lucide-react";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  getMyOrganizations,
  createOrganizationSelfServe,
  updateOrganizationSelfServe,
  createOrganizationApiKey,
  type Organization,
} from "@/services/api/organizations";

const INPUT_DARK = "bg-white/10 border-white/20 text-white placeholder:text-slate-500";
// shadcn's Button variant="outline" ships its own bg-background (resolves light in this app,
// no dark-mode override wired up for that token — see components/ui/button.tsx:16), so a resting
// background override is required here, not just a hover one, or every outline button renders
// as a near-white rectangle regardless of the text color set alongside it.
const OUTLINE_BTN = "bg-white/[0.04] border border-white/15 text-slate-200 hover:bg-white/[0.08] hover:text-white transition-all";
const DARK_BG = "#0f0f12";
const LIGHT_BG = "#ffffff";
const TAB_BTN = (active: boolean) =>
  `flex-1 px-3 py-1.5 text-base rounded-lg transition-colors ${active ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`;

function StatusBadge({ status }: { status: Organization["checkout_status"] }) {
  const cls =
    status === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    status === "pending" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-white/10 text-slate-400 border-white/15";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${cls}`}>{status}</span>;
}

/**
 * Payout destination: either the org owner's own Loofta (Privy) Solana wallet, or an external
 * wallet address on any token/chain (via TokenCombobox, same picker used for send/claim flows).
 */
function PayoutDestinationPicker({
  wallet,
  onWalletChange,
  tokenSel,
  onTokenSelChange,
}: {
  wallet: string;
  onWalletChange: (v: string) => void;
  tokenSel: TokenSelection | undefined;
  onTokenSelChange: (sel: TokenSelection) => void;
}) {
  const { wallets: solanaWallets } = useSolanaWallets();
  const myWalletAddress = solanaWallets[0]?.address;
  const { data: tokens = [] } = useTokensQuery();
  const usingMyWallet = !!myWalletAddress && wallet === myWalletAddress;

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-white/[0.03] border border-white/10 rounded-xl p-1">
        <button
          type="button"
          disabled={!myWalletAddress}
          onClick={() => {
            if (!myWalletAddress) return;
            onWalletChange(myWalletAddress);
            onTokenSelChange({ symbol: "USDC", chain: "solana" });
          }}
          className={`${TAB_BTN(usingMyWallet)} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          My Loofta wallet
        </button>
        <button
          type="button"
          onClick={() => { if (usingMyWallet) onWalletChange(""); }}
          className={TAB_BTN(!usingMyWallet)}
        >
          External wallet
        </button>
      </div>

      {usingMyWallet ? (
        <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
          <Wallet className="w-4 h-4 text-slate-500 shrink-0" />
          <code className="flex-1 min-w-0 text-base text-slate-300 truncate">{myWalletAddress}</code>
          <span className="shrink-0 text-base text-slate-400">Solana USDC</span>
        </div>
      ) : (
        <>
          <Input
            value={wallet}
            onChange={(e) => onWalletChange(e.target.value.trim())}
            placeholder="Payout wallet address"
            className={`font-mono ${INPUT_DARK}`}
          />
          <TokenCombobox
            tokens={tokens}
            value={tokenSel}
            onChange={onTokenSelChange}
            placeholder="Select payout token & network…"
          />
        </>
      )}
    </div>
  );
}

function CreateOrgForm({ onCreated, onCancel }: { onCreated: () => void; onCancel?: () => void }) {
  const { getAccessToken } = usePrivy();
  const { email: privyEmail } = useAuth();
  const { toast } = useToast();
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState(privyEmail ?? "");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [recipientWallet, setRecipientWallet] = useState("");
  const [tokenSel, setTokenSel] = useState<TokenSelection | undefined>({ symbol: "USDC", chain: "solana" });
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (!organizationId.trim() || !name.trim() || !contactEmail.trim()) {
      toast({ variant: "destructive", title: "Name, organization ID, and contact email are required" });
      return;
    }
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      await createOrganizationSelfServe(
        {
          organization_id: organizationId.trim(),
          name: name.trim(),
          contact_email: contactEmail.trim(),
          website_url: websiteUrl.trim() || undefined,
          recipient_wallet: recipientWallet.trim() || undefined,
          token_symbol: tokenSel?.symbol,
          token_chain: tokenSel?.chain,
        },
        token,
      );
      toast({ title: "Organization created — pending admin approval" });
      onCreated();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to create organization", description: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [organizationId, name, contactEmail, websiteUrl, recipientWallet, tokenSel, getAccessToken, toast, onCreated]);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-base text-slate-400 mb-1.5 block">Organization name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" className={INPUT_DARK} />
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1.5 block">Organization ID (used in your checkout link)</label>
        <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value.trim())} placeholder="acme-corp" className={INPUT_DARK} />
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1.5 block">Contact email</label>
        <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value.trim())} placeholder="you@company.com" className={INPUT_DARK} />
        <p className="text-sm text-slate-500 mt-1">We use this to review and approve your organization.</p>
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1.5 block">Website (where you&apos;ll use checkout)</label>
        <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value.trim())} placeholder="https://yoursite.com" className={INPUT_DARK} />
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1.5 block">Payout destination (optional — can add later)</label>
        <PayoutDestinationPicker
          wallet={recipientWallet}
          onWalletChange={setRecipientWallet}
          tokenSel={tokenSel}
          onTokenSelChange={setTokenSel}
        />
      </div>
      <div className="flex gap-2">
        <GradientActionButton onClick={submit} loading={submitting} loadingText="Creating…" className="flex-1">
          Create organization
        </GradientActionButton>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className={`h-11 rounded-2xl ${OUTLINE_BTN}`}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-base text-slate-400">
        New organizations start pending — Loofta reviews and approves before checkout goes live.
      </p>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">{children}</h4>;
}

/**
 * Split into two sections that map to genuinely different concerns: profile is who the business
 * is (relevant everywhere, incl. admin review), checkout config is what actually drives
 * /checkout. A third "Payout SDK" section belongs here once phase 2 (send-to-social-identity)
 * exists — not built yet, so not scaffolded speculatively.
 */
function OrgSettingsForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [name, setName] = useState(org.name);
  const [contactEmail, setContactEmail] = useState(org.contact_email ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(org.website_url ?? "");
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? "");
  const [bgColor, setBgColor] = useState(org.bg_color === LIGHT_BG ? LIGHT_BG : DARK_BG);
  const [recipientWallet, setRecipientWallet] = useState(org.recipient_wallet ?? "");
  const initialTokenSel = useMemo<TokenSelection | undefined>(
    () => (org.token_symbol && org.token_chain ? { symbol: org.token_symbol, chain: org.token_chain } : { symbol: "USDC", chain: "solana" }),
    [org.token_symbol, org.token_chain],
  );
  const [tokenSel, setTokenSel] = useState<TokenSelection | undefined>(initialTokenSel);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      await updateOrganizationSelfServe(org.id, {
        name: name.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        website_url: websiteUrl.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        bg_color: bgColor.trim() || undefined,
        recipient_wallet: recipientWallet.trim() || undefined,
        token_symbol: tokenSel?.symbol,
        token_chain: tokenSel?.chain,
      }, token);
      toast({ title: "Saved" });
      onSaved();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to save", description: err.message });
    } finally {
      setSaving(false);
    }
  }, [org.id, name, contactEmail, websiteUrl, logoUrl, bgColor, recipientWallet, tokenSel, getAccessToken, toast, onSaved]);

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>Organization profile</SectionHeading>
        <div className="space-y-3">
          <div>
            <label className="text-base text-slate-400 mb-1.5 block">Organization name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_DARK} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-base text-slate-400 mb-1.5 block">Contact email</label>
              <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value.trim())} placeholder="you@company.com" className={INPUT_DARK} />
            </div>
            <div>
              <label className="text-base text-slate-400 mb-1.5 block">Website</label>
              <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value.trim())} placeholder="https://yoursite.com" className={INPUT_DARK} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <SectionHeading>Checkout settings</SectionHeading>
        <div className="space-y-3">
          <div>
            <label className="text-base text-slate-400 mb-1.5 block">Payout destination</label>
            <PayoutDestinationPicker
              wallet={recipientWallet}
              onWalletChange={setRecipientWallet}
              tokenSel={tokenSel}
              onTokenSelChange={setTokenSel}
            />
            {tokenSel?.chain?.toLowerCase() !== "solana" && (
              <p className="text-base text-slate-400 mt-1.5">
                Private payment routes through a Solana burner — only available when the payout destination is Solana.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-base text-slate-400 mb-1.5 block">Logo URL</label>
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value.trim())} placeholder="https://…" className={INPUT_DARK} />
            </div>
            <div>
              <label className="text-base text-slate-400 mb-1.5 block">Checkout page theme</label>
              <div className="flex gap-1 bg-white/[0.03] border border-white/10 rounded-xl p-1 h-10">
                <button
                  type="button"
                  onClick={() => setBgColor(DARK_BG)}
                  className={`${TAB_BTN(bgColor === DARK_BG)} flex items-center justify-center gap-1.5`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => setBgColor(LIGHT_BG)}
                  className={`${TAB_BTN(bgColor === LIGHT_BG)} flex items-center justify-center gap-1.5`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  Light
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <GradientActionButton onClick={save} loading={saving} loadingText="Saving…" className="w-auto px-6">
          Save settings
        </GradientActionButton>
      </div>
    </div>
  );
}

function ApiKeySection({ org }: { org: Organization }) {
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [minting, setMinting] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = useCallback(async () => {
    setMinting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const { apiKey } = await createOrganizationApiKey(org.id, token);
      setRawKey(apiKey);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to mint API key", description: err.message });
    } finally {
      setMinting(false);
    }
  }, [org.id, getAccessToken, toast]);

  const copy = () => {
    if (!rawKey) return;
    navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (org.checkout_status !== "active") {
    return <p className="text-base text-slate-400">API keys unlock once this organization is approved.</p>;
  }

  return (
    <div className="space-y-2">
      {rawKey ? (
        <div className="space-y-1.5">
          <p className="text-base text-amber-400">Copy this now — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
            <code className="flex-1 min-w-0 text-base text-slate-300 break-all">{rawKey}</code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={mint} disabled={minting} className={OUTLINE_BTN}>
          {minting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate API key"}
        </Button>
      )}
    </div>
  );
}

export default function DevelopersPage() {
  const { authenticated, login, ready } = useAuth();
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Never silently fall back to "no orgs" on a fetch failure — that renders identically to a
  // genuinely empty account and hides real problems (auth, routing, backend errors) behind what
  // looks like an empty state. Real incident: a route-ordering bug made this 401 for every
  // self-serve user while an org they'd already created sat right there in the database.
  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const { organizations } = await getMyOrganizations(token);
      setOrgs(organizations);
    } catch (err: any) {
      setFetchError(err?.message || "Failed to load your organizations");
      toast({ variant: "destructive", title: "Failed to load organizations", description: err?.message });
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, toast]);

  useEffect(() => {
    if (authenticated) fetchOrgs();
  }, [authenticated, fetchOrgs]);

  const handleCreated = useCallback(() => {
    setShowCreateForm(false);
    fetchOrgs();
  }, [fetchOrgs]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0f0f12] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0f0f12] flex flex-col items-center justify-center gap-4 px-4">
        <Building2 className="w-8 h-8 text-slate-500" />
        <p className="text-lg text-slate-200">Log in to manage your Loofta checkout</p>
        <GradientActionButton onClick={login} className="w-auto px-6">
          Log in
        </GradientActionButton>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f12] text-gray-100">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">Developers</h1>
            <p className="text-lg text-slate-400 mt-1">Manage your Loofta checkout organizations and API keys.</p>
          </div>
          {orgs && orgs.length > 0 && !showCreateForm && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreateForm(true)}
              className={`shrink-0 gap-1.5 ${OUTLINE_BTN}`}
            >
              <Plus className="w-4 h-4" />
              Add organization
            </Button>
          )}
        </div>

        {loading && !orgs && (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
        )}

        {fetchError && !loading && (
          <div className="border border-red-500/30 bg-red-500/[0.06] rounded-2xl p-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-lg text-red-300">Couldn&apos;t load your organizations</p>
              <p className="text-base text-slate-400 mt-1">{fetchError}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={fetchOrgs} className={OUTLINE_BTN}>
              Retry
            </Button>
          </div>
        )}

        {orgs && (orgs.length === 0 || showCreateForm) && (
          <div className="border border-white/10 rounded-2xl bg-white/[0.02] p-6">
            <h2 className="text-lg font-medium text-gray-200 mb-4">Create your organization</h2>
            <CreateOrgForm onCreated={handleCreated} onCancel={orgs.length > 0 ? () => setShowCreateForm(false) : undefined} />
          </div>
        )}

        {orgs?.map((org) => (
          <div key={org.id} className="border border-white/10 rounded-2xl bg-white/[0.02] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium text-gray-200">{org.name}</h2>
                <p className="text-base text-slate-400 font-mono">{org.organization_id}</p>
              </div>
              <StatusBadge status={org.checkout_status} />
            </div>

            {org.checkout_status === "active" && (
              <p className="text-base text-slate-400 font-mono break-all">
                pay.loofta.xyz/checkout?organizationId={org.organization_id}&amp;amount=25
              </p>
            )}

            <div>
              <h3 className="text-base text-slate-400 mb-2">API key</h3>
              <ApiKeySection org={org} />
            </div>

            <div>
              <h3 className="text-base text-slate-400 mb-2">Settings</h3>
              <OrgSettingsForm org={org} onSaved={fetchOrgs} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
