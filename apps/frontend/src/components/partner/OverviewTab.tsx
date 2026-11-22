"use client";

import { useEffect, useState } from "react";
import { Btn, Notice, PageHeader, StatCard } from "./ui";
import { usd, usePartnerApi } from "./usePartnerApi";
import type { Counts, NavKey } from "./PartnerShell";
import type { Treasury } from "./useTreasury";

type Overview = {
  paid_month_usd: number;
  paid_month_count: number;
  claim_rate_pct: number;
  paid_count: number;
  /** What you earned from your fee on withdrawals so far. */
  fees_earned_usd?: number;
  withdrawn_count?: number;
};

export function OverviewTab({ orgId, treasury, counts, go }: { orgId: string; treasury: Treasury; counts: Counts | null; go: (k: NavKey) => void }) {
  const call = usePartnerApi();
  const usdc = treasury.state && treasury.state.created ? treasury.state.usdc : null;
  const hasWallet = !!treasury.state && treasury.state.created;
  const [data, setData] = useState<Overview | null>(null);
  const [feeWallet, setFeeWallet] = useState<string | null | undefined>(undefined);
  const [look, setLook] = useState<{ name?: string; fee_fixed_usd?: number | string; fee_percent_bps?: number | string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `https://pay.loofta.com/withdraw?orgId=${encodeURIComponent(orgId)}`;
  // The sample page takes your name and fee from the link, so you see what a recipient sees, with a $400 payout.
  const demoParams = new URLSearchParams({ orgId: "demo", prize: "400" });
  if (look?.name) demoParams.set("name", look.name);
  if (look?.fee_fixed_usd !== undefined) demoParams.set("fee", String(Number(look.fee_fixed_usd)));
  if (look?.fee_percent_bps !== undefined) demoParams.set("pct", String(Number(look.fee_percent_bps) / 100));
  const demoLink = `https://pay.loofta.com/withdraw?${demoParams.toString()}`;
  const month = new Date().toLocaleString("en-US", { month: "long" });

  useEffect(() => {
    const base = `partners/${encodeURIComponent(orgId)}`;
    call<Overview>(`${base}/overview`).then(setData).catch((e: Error) => setError(e.message));
    call<{ fee_wallet: string | null; name?: string; fee_fixed_usd?: number | string; fee_percent_bps?: number | string }>(base)
      .then((s) => { setFeeWallet(s.fee_wallet); setLook(s); })
      .catch(() => setFeeWallet(null));
  }, [call, orgId]);

  const items: Array<{ done: boolean; title: string; desc: string; action: string; to: NavKey }> = [
    { done: hasWallet, title: "Create your company wallet", desc: "A shared wallet your team approves payouts from.", action: "Create", to: "wallet" },
    { done: (usdc ?? 0) > 0, title: "Fund your wallet", desc: "Send USDC on Solana. Network fees are paid in USDC.", action: "Open", to: "payouts" },
    { done: (counts?.recipients ?? 0) > 0, title: "Import recipients", desc: "Emails or social handles.", action: "Import", to: "recipients" },
    { done: (counts?.batches ?? 0) > 0, title: "Create your first batch", desc: "Paste people and amounts.", action: "Create", to: "payouts" },
    { done: !!feeWallet, title: "Set a fee wallet", desc: feeWallet === undefined || feeWallet ? "Where your withdrawal fees are sent." : "Set automatically when you fund your first batch, or choose one.", action: "Set up", to: "settings" },
  ];
  const doneCount = items.filter((i) => i.done).length;

  const next = items.findIndex((i) => !i.done);

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Overview"
        blurb="Your wallet, what you have paid out, and what still needs attention."
        actions={
          <>
            <Btn kind="ghost" onClick={() => go("recipients")}>
              Import recipients
            </Btn>
            <Btn onClick={() => go("payouts")}>New batch</Btn>
          </>
        }
      />

      {error && <Notice kind="error">{error}</Notice>}

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5">
        <StatCard label="Available" value={usdc === null ? "..." : usd(usdc)} hint="In your company wallet" />
        <StatCard label={`Paid out · ${month}`} value={data ? usd(data.paid_month_usd) : "..."} hint={data ? `${data.paid_month_count} payouts` : undefined} />
        <StatCard label="Claim rate" value={data ? `${data.claim_rate_pct}%` : "..."} hint="Claimed or withdrawn" />
        <StatCard
          label="Fees earned"
          value={data ? usd(data.fees_earned_usd ?? 0) : "..."}
          hint={data ? `From ${data.withdrawn_count ?? 0} withdrawal${data.withdrawn_count === 1 ? "" : "s"}` : undefined}
          dot="green"
        />
      </section>

      <section className="flex flex-col gap-[18px]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.025em] text-[#1D1D1F]">Checklist</h2>
            <p className="m-0 text-[15px] text-[#6E6E73]">{doneCount} of {items.length} done before your first payout.</p>
          </div>
          <div className="flex gap-1" aria-hidden>
            {items.map((it, i) => (
              <span key={it.title} className={`h-[5px] w-7 rounded-[3px] transition-colors ${it.done ? "bg-[#1F9D55]" : i === next ? "bg-[#FF4A1C]" : "bg-[#E5E5EA]"}`} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {items.map((it, i) => {
            const isNext = i === next;
            return (
              <div
                key={it.title}
                className={`flex flex-wrap items-center gap-4 rounded-2xl py-4 pl-[18px] pr-4 transition-shadow ${isNext ? "bg-white shadow-[0_0_0_1.5px_rgba(255,74,28,0.35),0_10px_30px_-16px_rgba(255,74,28,0.35)]" : "bg-[#FAFAFB] shadow-[0_0_0_1px_#EDEDF0]"}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${it.done ? "bg-[#1F9D55] text-white" : isNext ? "border-[1.5px] border-[#FF4A1C] bg-white text-[#FF4A1C]" : "border-[1.5px] border-[#D2D2D7] bg-white text-[#86868B]"}`}
                >
                  {it.done ? "✓" : i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className={`text-[15px] font-semibold ${it.done ? "text-[#86868B]" : "text-[#1D1D1F]"}`}>{it.title}</div>
                  <div className="text-[13.5px] text-[#86868B]">{it.desc}</div>
                </div>
                <button
                  type="button"
                  onClick={() => go(it.to)}
                  className={`shrink-0 rounded-full px-4 py-2 text-[13.5px] font-semibold transition ${it.done ? "bg-transparent text-[#1F9D55]" : isNext ? "bg-[#1D1D1F] text-white hover:bg-black" : "bg-[#F2F2F4] text-[#1D1D1F] hover:bg-[#E8E8ED]"}`}
                >
                  {it.done ? "Done" : it.action}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[24px] font-extrabold tracking-[-0.025em] text-[#1D1D1F]">Withdraw page</h2>
          <p className="m-0 text-[15px] text-[#6E6E73]">Send recipients here to see what they received and withdraw it. Your fee is shown before they confirm.</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-[#F5F5F7] py-2 pl-[18px] pr-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-[12px] text-[#86868B]">Link for your users</div>
            <div className="truncate font-mono text-[14px] text-[#1D1D1F]">{link}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="min-w-[84px] shrink-0 rounded-xl bg-white px-[18px] py-2.5 text-[14px] font-medium text-[#1D1D1F] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition hover:bg-[#FAFAFB]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a href={demoLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-full bg-[#F2F2F4] px-5 py-[11px] text-[14px] font-medium text-[#1D1D1F] transition hover:bg-[#E8E8ED]">
            Preview with a sample payout
          </a>
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-[14px] font-semibold text-[#E8461A] hover:underline">
            Open your live page
          </a>
        </div>
      </section>
    </div>
  );
}
