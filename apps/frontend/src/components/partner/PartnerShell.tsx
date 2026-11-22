"use client";

import { useState, type ReactNode } from "react";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { UserMenu } from "@/components/UserMenu";
import { Avatar } from "./ui";
import { usd, type PartnerRole } from "./usePartnerApi";

// The typefaces of the portal design: Manrope for text, JetBrains Mono for labels and addresses.
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-partner-sans" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-partner-mono" });

export type NavKey = "overview" | "wallet" | "payouts" | "activity" | "recipients" | "team" | "developers" | "settings" | "guide";
export type Org = { org_id: string; name: string; logo_url: string | null; status: string; role: PartnerRole };
export type Counts = { batches: number; payouts: number; recipients: number; members: number };

const GROUPS: Array<{ label: string; items: Array<{ key: NavKey; label: string; count?: keyof Counts }> }> = [
  {
    label: "Workspace",
    items: [
      { key: "overview", label: "Overview" },
      { key: "wallet", label: "Wallet" },
    ],
  },
  {
    label: "Payments",
    items: [
      { key: "payouts", label: "Payouts", count: "batches" },
      { key: "activity", label: "Activity", count: "payouts" },
      { key: "recipients", label: "Recipients", count: "recipients" },
    ],
  },
  {
    label: "Organization",
    items: [
      { key: "team", label: "Team", count: "members" },
      { key: "developers", label: "Developers" },
      { key: "settings", label: "Settings" },
    ],
  },
  {
    label: "Help",
    items: [{ key: "guide", label: "How it works" }],
  },
];

function OrgSwitcher({ orgs, current, onSelect, onAdd }: { orgs: Org[]; current: Org; onSelect: (id: string) => void; onAdd?: () => void }) {
  const [open, setOpen] = useState(false);
  const mark = (o: Org, size: number) =>
    o.logo_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={o.logo_url} alt="" style={{ width: size, height: size }} className="rounded-[7px] object-cover" referrerPolicy="no-referrer" />
    ) : (
      <span style={{ width: size, height: size }} className="flex items-center justify-center rounded-[7px] bg-[#1D1D1F] text-[12px] font-semibold text-white">
        {o.name.slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl py-[5px] pl-[5px] pr-2.5 text-[14px] text-[#1D1D1F] transition hover:bg-black/[0.05]"
      >
        {mark(current, 24)}
        <span className="max-w-[140px] truncate font-medium">{current.name}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="#86868B" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-2 min-w-[240px] rounded-2xl bg-white p-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_50px_-20px_rgba(40,25,15,0.3)]">
            {orgs.map((o) => (
              <button
                key={o.org_id}
                type="button"
                onClick={() => {
                  onSelect(o.org_id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] hover:bg-black/[0.04] ${o.org_id === current.org_id ? "font-semibold text-[#1D1D1F]" : "text-[#4F4F57]"}`}
              >
                {mark(o, 24)}
                <span className="truncate">{o.name}</span>
              </button>
            ))}
            {onAdd && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
                className="mt-1 flex w-full items-center gap-2.5 rounded-xl border-t border-black/[0.06] px-2.5 pb-2 pt-3 text-left text-[14px] font-medium text-[#4F4F57] hover:text-[#1D1D1F]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-dashed border-black/20 text-[16px] leading-none">+</span>
                Add a company
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Chrome for the partner portal, sized to the design file: header (logo, org switcher, Docs,
 * Support, account), a bordered panel with a 236px grouped sidebar and a funding wallet card, and a
 * footer. Reusable for other developer-facing pages.
 */
export function PartnerShell({
  orgs,
  current,
  onSelectOrg,
  tab,
  onTab,
  counts,
  usdc,
  signedIn,
  authReady,
  onSignIn,
  onLogout,
  username,
  email,
  centered,
  onAddCompany,
  children,
}: {
  orgs: Org[];
  current: Org | null;
  onSelectOrg: (id: string) => void;
  tab: NavKey;
  onTab: (k: NavKey) => void;
  counts: Counts | null;
  usdc: number | null;
  signedIn: boolean;
  authReady: boolean;
  onSignIn: () => void;
  onLogout: () => void;
  username: string | null;
  email: string | undefined;
  /** Centre the content, for the public landing page. */
  centered?: boolean;
  /** Shows "Add a company" in the company selector. */
  onAddCompany?: () => void;
  children: ReactNode;
}) {
  // A company that is not approved yet has nothing to navigate: it sees its review status, not the product.
  const showSidebar = signedIn && !!current && current.status === "active";
  const bal = usdc === null ? "..." : usd(usdc).replace("$", "");

  return (
    <div
      className={`partner-root pt-light ${manrope.variable} ${jbMono.variable} flex min-h-[calc(100vh-var(--header-h,0px))] flex-col text-[#1D1D1F]`}
      style={{
        fontFamily: "var(--font-partner-sans), -apple-system, BlinkMacSystemFont, sans-serif",
        background: "radial-gradient(800px 500px at 95% -10%,rgba(255,196,170,0.28),rgba(255,196,170,0) 70%),#F5F5F7",
      }}
    >
      <style>{`.partner-root .font-mono{font-family:var(--font-partner-mono),ui-monospace,monospace}.partner-root h1,.partner-root h2,.partner-root h3,.partner-root button,.partner-root input,.partner-root textarea,.partner-root select{font-family:inherit}`}</style>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-[rgba(245,245,247,0.78)] px-5 py-3 backdrop-blur-[20px] [backdrop-filter:saturate(1.8)_blur(20px)]">
        <div className="flex min-w-0 items-center gap-4">
          <LooftaPayLogoLink imageWidth={110} imageHeight={26} imageClassName="h-[22px] w-auto" src="/loofta.svg" />
          {current && (
            <>
              <span className="hidden h-5 w-px bg-black/10 sm:block" />
              <div className="hidden sm:block">
                <OrgSwitcher orgs={orgs} current={current} onSelect={onSelectOrg} onAdd={onAddCompany} />
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <a href="https://t.me/looftaxyz" target="_blank" rel="noopener noreferrer" className="hidden text-[14px] text-[#6E6E73] transition hover:text-[#1D1D1F] sm:inline">
            Support
          </a>
          {!authReady ? null : signedIn ? (
            <UserMenu username={username} email={email} isDarkPage={false} onLogout={onLogout} />
          ) : (
            <button type="button" onClick={onSignIn} className="rounded-full bg-white px-4 py-1.5 text-[14px] font-medium text-[#1D1D1F] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition hover:bg-[#F2F2F4]">
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="flex min-w-0 flex-1 gap-0 px-3 pb-3">
        {showSidebar && current && (
          <aside className="sticky top-[60px] hidden h-[calc(100vh-84px)] w-[clamp(176px,18vw,232px)] shrink-0 flex-col justify-between gap-6 self-start overflow-y-auto px-3 py-5 lg:flex">
            <div className="flex flex-col gap-[22px]">
              <div className="px-2.5 text-[13px] font-semibold text-[#86868B]">Partner portal</div>
              {GROUPS.map((g) => (
                <div key={g.label} className="flex flex-col gap-0.5">
                  <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.02em] text-[#AEAEB2]">{g.label}</div>
                  {g.items.map((it) => {
                    const on = tab === it.key;
                    const n = it.count && counts ? counts[it.count] : null;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        onClick={() => onTab(it.key)}
                        className={`flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-[7px] text-left text-[14px] text-[#1D1D1F] transition hover:bg-black/[0.04] ${on ? "bg-white font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.05)]" : "font-normal"}`}
                      >
                        <span>{it.label}</span>
                        {n !== null && n > 0 && <span className="text-[12px] text-[#86868B]">{n}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onTab("wallet")}
              className="flex flex-col gap-1 rounded-[14px] bg-white p-3.5 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.04)] transition hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
            >
              <div className="text-[12px] text-[#86868B]">Company wallet</div>
              <div className="text-[15px] font-semibold text-[#1D1D1F]">
                {bal} <span className="text-[12px] font-medium text-[#86868B]">USDC</span>
              </div>
            </button>
          </aside>
        )}

        <main className="min-w-0 flex-1 rounded-[22px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_20px_50px_-30px_rgba(40,25,15,0.15)]">
          <div className={`flex w-full max-w-[1000px] flex-col px-[clamp(20px,4vw,56px)] pb-[72px] pt-[clamp(28px,4vw,56px)] mx-auto`}>
            {showSidebar && (
              <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
                {GROUPS.flatMap((g) => g.items).map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onTab(it.key)}
                    className={`shrink-0 rounded-full px-3.5 py-2 text-[14px] ${tab === it.key ? "bg-[#1D1D1F] font-semibold text-white" : "bg-[#F2F2F4] text-[#4F4F57]"}`}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>

      <footer className="flex flex-wrap justify-between gap-4 px-5 py-4 text-[13px] text-[#86868B]">
        <div className="flex gap-5">
          <a href="/terms" className="hover:text-[#1D1D1F]">Terms</a>
          <a href="/privacy" className="hover:text-[#1D1D1F]">Privacy</a>
        </div>
        <div className="flex gap-5">
          <a href="/docs" className="hover:text-[#1D1D1F]">Docs</a>
          <a href="https://t.me/looftaxyz" target="_blank" rel="noopener noreferrer" className="hover:text-[#1D1D1F]">Support</a>
        </div>
      </footer>
    </div>
  );
}
