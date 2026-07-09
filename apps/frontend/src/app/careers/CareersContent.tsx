'use client'

import { useState } from "react";
import { MinimalHeader } from "@/components/layout/MinimalHeader";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF4A26] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";

export default function CareersPage() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-20">
            <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              We&apos;re hiring
            </span>

            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white mb-6">
              Build the future of<br />
              private payments
            </h1>

            <p className="font-grotesk text-[17px] md:text-[19px] leading-[1.65] text-slate-400 max-w-xl">
              Small team, real traction, well-positioned. If you want to own something meaningful in
              crypto payments — read on.
            </p>
          </div>

          {/* Open roles */}
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-5">
              Open roles · 1
            </p>
            <JobCard />
          </div>
        </div>
      </main>
    </>
  );
}

function JobCard() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#1e1e24]/95 to-[#111114]/95 backdrop-blur-xl overflow-hidden shadow-[0_2px_40px_rgba(0,0,0,0.4)]">
      {/* Card header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-7 py-6 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
      >
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-white font-semibold text-xl md:text-2xl font-display tracking-tight">
              Founding Growth &amp; BD
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold text-white ${BRAND_GRADIENT}`}>
              Remote
            </span>
          </div>
          <p className="text-slate-400 text-base md:text-[15px]">
            Full-time · Contractor · Solana / Payments
          </p>
        </div>
        <span
          className="flex-shrink-0 text-slate-400 text-xl transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ↓
        </span>
      </button>

      {/* Expanded JD */}
      {open && (
        <div className="border-t border-white/[0.06]">
          {/* Intro */}
          <div className="px-7 pt-8 pb-6">
            <p className="font-grotesk text-[17px] leading-[1.7] text-slate-300">
              Loofta Pay is private payments on Solana — get paid and pay others without exposing your
              whole wallet history. We&apos;re early, well-positioned, and looking for our founding
              growth person to drive real adoption.
            </p>
          </div>

          <div className="px-7 pb-8 flex flex-col gap-10">
            <JDSection title="What you'll do">
              <JDItem>
                Own user acquisition: find and onboard people who&apos;ll actually use Loofta Pay —
                freelancers receiving income, creators getting paid, and projects paying their teams in USDX.
              </JDItem>
              <JDItem>Recruit and activate KOLs to post about Loofta Pay and drive signups.</JDItem>
              <JDItem>
                Run outbound BD: source, pitch, and close the users and partnerships that grow payment volume.
              </JDItem>
              <JDItem>
                Use content where it serves growth — thesis tweets on why private payments matter, weekly
                Solana updates featuring Loofta, presence in Solana/Colosseum app lists.
              </JDItem>
              <JDItem>
                Report weekly on what matters: new active users, payment volume, KOL-driven signups.
              </JDItem>
            </JDSection>

            <JDSection title="You might be a fit if">
              <JDItem>You&apos;re scrappy, high-agency, and comfortable owning a number from day one.</JDItem>
              <JDItem>You get crypto/Solana and the privacy + payments thesis.</JDItem>
              <JDItem>You can do outbound — DMs, pitches, follow-ups — not just create content.</JDItem>
              <JDItem>Fluent English; other languages a plus.</JDItem>
              <JDItem>Bonus: an existing audience or network in crypto.</JDItem>
            </JDSection>

            <div>
              <h3 className="text-white font-semibold text-lg md:text-xl font-display mb-3">Comp</h3>
              <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
                Base + performance bonus tied to activations/volume + token allocation. Remote, contractor.
                Starts with a paid trial.
              </p>
            </div>

            {/* Apply CTA */}
            <div className={`relative overflow-hidden rounded-2xl p-[1px] ${BRAND_GRADIENT}`}>
              <div className="rounded-[15px] bg-[#0f0f12]/95 backdrop-blur-xl px-6 py-6">
                <p className="text-white font-semibold text-lg font-display mb-1">Apply</p>
                <p className="text-slate-400 text-[15px] leading-relaxed mb-4">
                  Send your resume to{" "}
                  <ObfuscatedEmail user="hello" domain="loofta.xyz" />.
                </p>
                <button
                  onClick={() => {
                    window.location.href = "mailto:hello@loofta.xyz";
                  }}
                  className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
                >
                  Send application
                  <span className="text-white/70">→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JDSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-white font-semibold text-lg md:text-xl font-display mb-4">{title}</h3>
      <ul className="flex flex-col gap-3.5">{children}</ul>
    </div>
  );
}

function JDItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="mt-[10px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF4A26]/60" />
      <span className="font-grotesk text-[16px] leading-[1.7] text-slate-400">{children}</span>
    </li>
  );
}

function ObfuscatedEmail({ user, domain }: { user: string; domain: string }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        window.location.href = `mailto:${user}@${domain}`;
      }}
      className="text-[#FF7A2A] hover:text-[#FF4A26] transition-colors font-medium"
    >
      {user}
      <span aria-hidden="true">&#64;</span>
      {domain}
    </a>
  );
}
