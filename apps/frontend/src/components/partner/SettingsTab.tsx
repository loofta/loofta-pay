"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Field, Notice, PageHeader, SplitSection, inputCls } from "./ui";
import { LogoUpload } from "./LogoUpload";
import { patch, post, usd, usePartnerApi, type PartnerRole } from "./usePartnerApi";

type Settings = {
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  description: string | null;
  legal_name: string | null;
  country: string | null;
  website: string | null;
  contact_email: string | null;
  withdraw_min_usd: number;
  fee_fixed_usd: number;
  fee_percent_bps: number;
  fee_wallet: string | null;
  fee_wallet_pending: string | null;
  fee_wallet_effective_at: string | null;
  approval_threshold_usd: number;
  show_history?: boolean;
  disabled_withdraw_methods?: string[];
  my_role: PartnerRole;
};

const METHOD_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "usdc", label: "USDC on Solana", hint: "To any Solana wallet" },
  { id: "token", label: "Other tokens", hint: "BTC, ETH, ZEC and other chains" },
  { id: "bank", label: "Bank or cards", hint: "Bank account, debit card or PAJ Cash" },
  { id: "p2p", label: "Private P2P", hint: "Wise, PayPal, Revolut, Venmo and more" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function SettingsTab({ orgId }: { orgId: string }) {
  const call = usePartnerApi();
  const base = `partners/${encodeURIComponent(orgId)}`;
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState("");

  const load = useCallback(() => {
    call<Settings>(base).then(setS).catch((e: Error) => setError(e.message));
  }, [call, base]);
  useEffect(load, [load]);

  if (!s) {
    return (
      <>
        <PageHeader crumb="Partner portal / Settings" title="Your page and fees" />
        {error ? <Notice kind="error">{error}</Notice> : <p className="text-[15px] text-[#C9C9D0]">Loading...</p>}
      </>
    );
  }

  const isOwner = s.my_role === "owner";
  const canEdit = isOwner || s.my_role === "admin";
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  const save = async (path: string, body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await call(path, patch(body));
      setSaved(ok);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // What a recipient pays on a $100 withdrawal, before Loofta's own fee, so the partner sees their effect.
  const sample = Math.min(100 * (s.fee_percent_bps / 10000) + s.fee_fixed_usd, 25);
  const color = s.brand_color && HEX.test(s.brand_color) ? s.brand_color : null;

  return (
    <>
      <PageHeader
        crumb="Partner portal / Settings"
        title="Your page and fees"
        blurb="Your logo and description, the fees you add on withdrawals, and where those fees are sent."
      />
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {saved && (
        <div className="mb-6">
          <Notice kind="ok">{saved}</Notice>
        </div>
      )}

      <SplitSection title="Your page" desc="What recipients see on your withdraw page.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputCls} disabled={!canEdit} value={s.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Brand colour" hint="Hex, for example #7c3aed">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 rounded-md border border-white/15" style={{ background: color ?? "transparent" }} />
              <input className={`${inputCls} pl-12`} disabled={!canEdit} value={s.brand_color ?? ""} placeholder="#7c3aed" onChange={(e) => set("brand_color", e.target.value)} />
            </div>
          </Field>
        </div>
        <Field label="Logo">
          <LogoUpload value={s.logo_url} disabled={!canEdit} onChange={(url) => set("logo_url", url)} />
        </Field>
        <Field label="Business description" hint="Shown to recipients on your withdraw page. Up to 500 characters.">
          <textarea className={`${inputCls} min-h-[110px]`} maxLength={500} disabled={!canEdit} value={s.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Legal name" optional>
            <input className={inputCls} disabled={!canEdit} value={s.legal_name ?? ""} onChange={(e) => set("legal_name", e.target.value)} />
          </Field>
          <Field label="Website" optional>
            <input className={inputCls} disabled={!canEdit} value={s.website ?? ""} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Contact email" optional>
            <input className={inputCls} disabled={!canEdit} value={s.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
          </Field>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Btn
              disabled={busy}
              onClick={() =>
                void save(
                  base,
                  {
                    name: s.name,
                    logo_url: s.logo_url || null,
                    ...(s.description ? { description: s.description } : {}),
                    ...(s.brand_color ? { brand_color: s.brand_color } : {}),
                    ...(s.legal_name ? { legal_name: s.legal_name } : {}),
                    ...(s.website ? { website: s.website } : {}),
                    ...(s.contact_email ? { contact_email: s.contact_email } : {}),
                  },
                  "Saved.",
                )
              }
            >
              Save page
            </Btn>
          </div>
        )}
      </SplitSection>

      <SplitSection title="Withdrawal fees" desc="Added on top of Loofta's own fee. Recipients see both before they confirm.">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Minimum withdrawal (USD)">
            <input type="number" min={0} className={inputCls} disabled={!canEdit} value={s.withdraw_min_usd} onChange={(e) => set("withdraw_min_usd", Number(e.target.value))} />
          </Field>
          <Field label="Flat fee (USD)" hint="Once per withdrawal, max $25">
            <input type="number" min={0} max={25} step="0.01" className={inputCls} disabled={!canEdit} value={s.fee_fixed_usd} onChange={(e) => set("fee_fixed_usd", Number(e.target.value))} />
          </Field>
          <Field label="Percent fee (%)" hint="Of each withdrawal, on top of the fixed fee. 1 means 1%. Up to 10%.">
            <input
              type="number"
              min={0}
              max={10}
              step={0.01}
              className={inputCls}
              disabled={!canEdit}
              value={Number((s.fee_percent_bps / 100).toFixed(2))}
              onChange={(e) => set("fee_percent_bps", Math.min(1000, Math.max(0, Math.round((Number(e.target.value) || 0) * 100))))}
            />
          </Field>
        </div>
        <p className="text-[15px] text-[#C9C9D0]">
          On a $100 withdrawal you earn about <span className="text-[#EDEDEF]">{usd(sample)}</span>. It can never exceed 25% of a payout.
        </p>
        {canEdit && (
          <div className="flex justify-end">
            <Btn
              disabled={busy}
              onClick={() => void save(`${base}/settings`, { withdraw_min_usd: s.withdraw_min_usd, fee_fixed_usd: s.fee_fixed_usd, fee_percent_bps: s.fee_percent_bps }, "Fees saved.")}
            >
              Save fees
            </Btn>
          </div>
        )}
      </SplitSection>

      <SplitSection title="Withdraw page" desc="What your recipients can do on your withdraw page. Everything is on unless you switch it off.">
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#121214] p-3.5">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              disabled={!canEdit}
              checked={s.show_history !== false}
              onChange={(e) => set("show_history", e.target.checked)}
            />
            <span>
              <span className="block text-[15px] font-medium text-[#EDEDEF]">Show payout history</span>
              <span className="block text-[14px] text-[#9C9CA5]">Recipients see the payouts they already withdrew from you. They only ever see their own.</span>
            </span>
          </label>
          <p className="pt-2 text-[14px] text-[#9C9CA5]">Ways to withdraw</p>
          {METHOD_OPTIONS.map((m) => {
            const off = s.disabled_withdraw_methods ?? [];
            const enabled = !off.includes(m.id);
            // The last route left on cannot be switched off, or recipients would have no way to cash out.
            const last = enabled && METHOD_OPTIONS.length - off.length <= 1;
            return (
              <label key={m.id} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#121214] p-3.5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  disabled={!canEdit || last}
                  checked={enabled}
                  onChange={(e) => set("disabled_withdraw_methods", e.target.checked ? off.filter((x) => x !== m.id) : [...off, m.id])}
                />
                <span>
                  <span className="block text-[15px] font-medium text-[#EDEDEF]">{m.label}</span>
                  <span className="block text-[14px] text-[#9C9CA5]">{m.hint}</span>
                </span>
              </label>
            );
          })}
          <p className="text-[14px] text-[#9C9CA5]">At least one way must stay on. Recipients always keep their money, this only changes which options your page offers.</p>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Btn
              disabled={busy}
              onClick={() => void save(`${base}/settings`, { show_history: s.show_history !== false, disabled_withdraw_methods: s.disabled_withdraw_methods ?? [] }, "Withdraw page saved.")}
            >
              Save withdraw page
            </Btn>
          </div>
        )}
      </SplitSection>

      <SplitSection title="Fee wallet" desc="Where your withdrawal fees are sent.">
        {s.fee_wallet ? (
          <p className="break-all font-mono text-[15px] text-[#EDEDEF]">{s.fee_wallet}</p>
        ) : (
          <p className="text-[15px] text-[#C9C9D0]">Not set yet. It is set to your funding wallet the first time you fund a batch, or you can choose another wallet below.</p>
        )}
        {s.fee_wallet_pending && (
          <div className="space-y-3">
            <Notice kind="info">
              A change to {s.fee_wallet_pending.slice(0, 6)}...{s.fee_wallet_pending.slice(-4)} takes effect {s.fee_wallet_effective_at ? new Date(s.fee_wallet_effective_at).toLocaleString() : "soon"}.
            </Notice>
            {isOwner && (
              <Btn kind="ghost" disabled={busy} onClick={() => void call(`${base}/settings/cancel-fee-wallet-change`, post()).then(load).catch((e: Error) => setError(e.message))}>
                Cancel the change
              </Btn>
            )}
          </div>
        )}
        {isOwner ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Use a different wallet" hint="It must already hold some USDC. A new wallet takes 24 hours to activate, so a stolen login cannot redirect your fees at once.">
                <input className={inputCls} value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Solana address" />
              </Field>
            </div>
            <Btn disabled={busy || wallet.length < 32} onClick={() => void save(`${base}/settings`, { fee_wallet: wallet.trim() }, "Fee wallet saved.")}>
              Set wallet
            </Btn>
          </div>
        ) : (
          <p className="text-[14px] text-[#9C9CA5]">Only an owner can change this.</p>
        )}
      </SplitSection>

      <SplitSection title="Approval limit" desc="Batches above this amount need a second member to approve. Set 0 to turn it off.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-60">
            <Field label="Over (USD)">
              <input type="number" min={0} className={inputCls} disabled={!isOwner} value={s.approval_threshold_usd} onChange={(e) => set("approval_threshold_usd", Number(e.target.value))} />
            </Field>
          </div>
          {isOwner && (
            <Btn disabled={busy} onClick={() => void save(`${base}/settings`, { approval_threshold_usd: s.approval_threshold_usd }, "Approval limit saved.")}>
              Save limit
            </Btn>
          )}
        </div>
      </SplitSection>
    </>
  );
}
