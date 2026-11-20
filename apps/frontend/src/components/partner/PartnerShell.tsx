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

export type NavKey = "overview" | "wallet" | "payouts" | "activity" | "recipients" | "team" | "developers" | "settings";
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
];

function OrgSwitcher({ orgs, current, onSelect }: { orgs: Org[]; current: Org; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.02] py-1.5 pl-1.5 pr-2.5 text-[#EDEDEF]"
      >
        {current.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.logo_url} alt="" className="h-6 w-6 rounded-[7px] object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Avatar name={current.name} size={24} />
        )}
        <span className="max-w-[140px] truncate text-[14.5px] font-semibold">{current.name}</span>
        <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11.5px] text-[#9C9CA5]">Partner</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="#9C9CA5" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-2 min-w-[220px] rounded-xl border border-white/10 bg-[#141416] p-1.5 shadow-2xl">
            {orgs.map((o) => (
              <button
                key={o.org_id}
                type="button"
                onClick={() => {
                  onSelect(o.org_id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14.5px] hover:bg-white/[0.06] ${o.org_id === current.org_id ? "text-[#EDEDEF]" : "text-[#C9C9D0]"}`}
              >
                <Avatar name={o.name} size={24} />
                <span className="truncate">{o.name}</span>
              </button>
            ))}
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
  children: ReactNode;
}) {
  const showSidebar = signedIn && !!current;
  const bal = usdc === null ? "..." : usd(usdc).replace("$", "");

  return (
    <div
      className={`partner-root ${manrope.variable} ${jbMono.variable} flex min-h-[calc(100vh-var(--header-h,0px))] flex-col text-[#EDEDEF]`}
      style={{ fontFamily: "var(--font-partner-sans), -apple-system, BlinkMacSystemFont, sans-serif", background: "radial-gradient(1100px 600px at 70% -200px,rgba(255,255,255,0.045),rgba(255,255,255,0) 70%),#09090A" }}
    >
      <style>{`.partner-root .font-mono{font-family:var(--font-partner-mono),ui-monospace,monospace}.partner-root h1,.partner-root h2,.partner-root h3,.partner-root button,.partner-root input,.partner-root textarea,.partner-root select{font-family:inherit}`}</style>
      <header className="flex items-center justify-between gap-4 px-[clamp(16px,3vw,40px)] py-[18px]">
        <div className="flex min-w-0 items-center gap-4">
          <LooftaPayLogoLink imageWidth={110} imageHeight={26} imageClassName="h-[26px] w-auto" />
          {current && (
            <>
              <span className="hidden h-[22px] w-px bg-white/[0.12] sm:block" />
              <div className="hidden sm:block">
                <OrgSwitcher orgs={orgs} current={current} onSelect={onSelectOrg} />
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <a href="/docs" className="hidden text-[14.5px] text-[#C9C9D0] transition hover:text-[#EDEDEF] sm:inline">
            Docs
          </a>
          <a href="mailto:hello@loofta.xyz" className="hidden text-[14.5px] text-[#C9C9D0] transition hover:text-[#EDEDEF] sm:inline">
            Support
          </a>
          {!authReady ? null : signedIn ? (
            <UserMenu username={username} email={email} isDarkPage={true} onLogout={onLogout} />
          ) : (
            <button type="button" onClick={onSignIn} className="text-[14.5px] font-medium text-[#EDEDEF] transition hover:text-white">
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="mx-[clamp(8px,2vw,28px)] flex min-w-0 flex-1 rounded-[22px] border border-white/[0.07] bg-[rgba(14,14,16,0.7)]">
        {showSidebar && current && (
          <aside className="sticky top-0 hidden h-[calc(100vh-var(--header-h,0px))] w-[236px] shrink-0 flex-col gap-7 self-start overflow-y-auto border-r border-white/[0.06] py-9 pl-6 pr-5 lg:flex">
            <div className="flex items-center gap-2 px-2.5">
              <span className="text-[14.5px] font-semibold">Partner portal</span>
              <span className="rounded-md bg-white/[0.06] px-[7px] py-0.5 font-mono text-[11.5px] text-[#C9C9D0]">Payouts</span>
            </div>

            {GROUPS.map((g) => (
              <div key={g.label} className="flex flex-col gap-0.5">
                <div className="px-2.5 pb-2 font-mono text-[11.5px] uppercase tracking-[0.12em] text-[#8E8E98]">{g.label}</div>
                {g.items.map((it) => {
                  const on = tab === it.key;
                  const n = it.count && counts ? counts[it.count] : null;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => onTab(it.key)}
                      className={`flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-[9px] text-left text-[15px] transition hover:bg-white/[0.05] hover:text-[#EDEDEF] ${on ? "bg-white/[0.07] font-semibold text-[#EDEDEF]" : "font-medium text-[#C9C9D0]"}`}
                    >
                      <span>{it.label}</span>
                      {n !== null && n > 0 && <span className="font-mono text-[11.5px] text-[#9C9CA5]">{n}</span>}
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="mt-auto flex flex-col gap-3.5">
              <button
                type="button"
                onClick={() => onTab("wallet")}
                className="flex flex-col gap-1.5 rounded-xl border border-white/[0.07] bg-[#121214] p-3.5 text-left"
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#9C9CA5]">Company wallet</div>
                <div className="text-[22.5px] font-semibold">
                  {bal} <span className="text-[13.5px] font-medium text-[#C9C9D0]">USDC</span>
                </div>
                <div className="text-[13px] text-[#B4B4BC]">Network fees paid in USDC</div>
              </button>
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1 px-[clamp(18px,4vw,56px)] pb-16 pt-[clamp(24px,4vw,48px)]">
          <div className={`flex max-w-[960px] flex-col ${centered ? "mx-auto" : ""}`}>
            {showSidebar && (
              <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
                {GROUPS.flatMap((g) => g.items).map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onTab(it.key)}
                    className={`shrink-0 rounded-[9px] border border-white/[0.08] px-3 py-2 text-[14px] ${tab === it.key ? "bg-white/[0.07] font-semibold text-[#EDEDEF]" : "text-[#C9C9D0]"}`}
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

      <footer className="flex flex-wrap justify-between gap-4 px-[clamp(16px,3vw,40px)] py-[18px] text-[13.5px] text-[#8E8E98]">
        <div className="flex gap-5">
          <a href="/terms" className="hover:text-[#C9C9D0]">
            Terms
          </a>
          <a href="/privacy" className="hover:text-[#C9C9D0]">
            Privacy
          </a>
        </div>
        <div className="flex gap-5">
          <a href="/docs" className="hover:text-[#C9C9D0]">
            Docs
          </a>
          <a href="mailto:hello@loofta.xyz" className="hover:text-[#C9C9D0]">
            Support
          </a>
        </div>
      </footer>
    </div>
  );
}
