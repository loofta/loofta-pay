"use client";

import { useEffect, useState } from "react";
import { ArrowIcon, Btn, CodeBox, Notice, PageHeader, Section, StatCard } from "./ui";
import { usd, usePartnerApi } from "./usePartnerApi";
import type { Counts, NavKey } from "./PartnerShell";
import type { Treasury } from "./useTreasury";

type Overview = {
  paid_month_usd: number;
  paid_month_count: number;
  claim_rate_pct: number;
  paid_count: number;
};

export function OverviewTab({ orgId, treasury, counts, go }: { orgId: string; treasury: Treasury; counts: Counts | null; go: (k: NavKey) => void }) {
  const call = usePartnerApi();
  const usdc = treasury.state && treasury.state.created ? treasury.state.usdc : null;
  const hasWallet = !!treasury.state && treasury.state.created;
  const [data, setData] = useState<Overview | null>(null);
  const [feeWallet, setFeeWallet] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `https://pay.loofta.xyz/withdraw?orgId=${encodeURIComponent(orgId)}`;
  const month = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

  useEffect(() => {
    const base = `partners/${encodeURIComponent(orgId)}`;
    call<Overview>(`${base}/overview`).then(setData).catch((e: Error) => setError(e.message));
    call<{ fee_wallet: string | null }>(base).then((s) => setFeeWallet(s.fee_wallet)).catch(() => setFeeWallet(null));
  }, [call, orgId]);

  const items: Array<{ done: boolean; title: string; desc: string; action: string; to: NavKey }> = [
    { done: hasWallet, title: "Create your company wallet", desc: "A shared wallet your team approves payouts from.", action: "Create", to: "wallet" },
    { done: (usdc ?? 0) > 0, title: "Fund your wallet", desc: "Send USDC on Solana. Network fees are paid in USDC.", action: "Open", to: "payouts" },
    { done: (counts?.recipients ?? 0) > 0, title: "Import recipients", desc: "Emails or social handles.", action: "Import", to: "recipients" },
    { done: (counts?.batches ?? 0) > 0, title: "Create your first batch", desc: "Paste people and amounts.", action: "Create", to: "payouts" },
    { done: !!feeWallet, title: "Set a fee wallet", desc: feeWallet === undefined || feeWallet ? "Where your withdrawal fees are sent." : "Set automatically when you fund your first batch, or choose one.", action: "Set up", to: "settings" },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <>
      <PageHeader
        crumb="Partner portal / Overview"
        title="Overview"
        blurb="Your wallet, what you have paid out, and what still needs attention."
        actions={
          <>
            <Btn onClick={() => go("payouts")}>
              New batch <ArrowIcon />
            </Btn>
            <Btn kind="ghost" onClick={() => go("recipients")}>
              Import recipients
            </Btn>
          </>
        }
      />

      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Available" value={usdc === null ? "..." : usd(usdc)} hint="In your company wallet" />
        <StatCard label={`Paid out · ${month}`} value={data ? usd(data.paid_month_usd) : "..."} hint={data ? `${data.paid_month_count} payouts` : undefined} />
        <StatCard label="Claim rate" value={data ? `${data.claim_rate_pct}%` : "..."} hint="Claimed or withdrawn" />
      </div>

      <Section title="Checklist" desc={`${doneCount} of ${items.length} done before your first payout.`}>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101012]">
          <div className="divide-y divide-white/10">
            {items.map((it, i) => (
              <div key={it.title} className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                <div className="flex items-center gap-4">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[14px] ${it.done ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-white/15 text-[#C9C9D0]"}`}
                  >
                    {it.done ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div>
                    <div className="text-[14.5px] font-medium text-[#EDEDEF]">{it.title}</div>
                    <div className="text-[14px] text-[#C9C9D0]">{it.desc}</div>
                  </div>
                </div>
                <Btn kind="ghost" onClick={() => go(it.to)}>
                  {it.action}
                </Btn>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Withdraw page" desc="Send recipients here to see what they received and withdraw it. Your fee is shown before they confirm.">
        <CodeBox
          title="Link for your users"
          value={link}
          copied={copied}
          onCopy={() => {
            void navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        />
      </Section>
    </>
  );
}
