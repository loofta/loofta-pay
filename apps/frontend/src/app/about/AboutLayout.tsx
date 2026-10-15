"use client";

import { useEffect, useState } from "react";
import { Section, P, UL } from "./legalParts";
import { TermsSections, TERMS_TOC, TERMS_EFFECTIVE } from "./TermsSections";
import { PrivacySections, PRIVACY_TOC, PRIVACY_EFFECTIVE } from "./PrivacySections";

const ABOUT_TOC = [
  { id: "about-who", label: "Who we are" },
  { id: "about-why", label: "Why we exist" },
  { id: "about-what", label: "What you can do" },
  { id: "about-custody", label: "Non-custodial by design" },
  { id: "about-partners", label: "Partners" },
  { id: "about-company", label: "Company details" },
  { id: "about-support", label: "Support" },
];

const GROUPS = [
  { id: "about", label: "About Loofta", toc: ABOUT_TOC },
  { id: "terms", label: "Terms of Service", toc: TERMS_TOC },
  { id: "privacy", label: "Privacy Policy", toc: PRIVACY_TOC },
];

const SUPPORT_EMAIL = "hello@loofta.xyz";
const link = "text-orange-400 hover:underline";

export default function AboutLayout() {
  const [active, setActive] = useState("about");

  useEffect(() => {
    const ids = ["about", "terms", "privacy", ...GROUPS.flatMap((g) => g.toc.map((i) => i.id))];
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const activeGroup = GROUPS.find((g) => g.id === active || g.toc.some((i) => i.id === active))?.id ?? "about";

  return (
    <main className="min-h-screen bg-[#111114] text-slate-100">
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-10 pb-24 flex gap-12">
        <nav className="hidden md:block w-64 shrink-0 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
          {GROUPS.map((group) => {
            const open = activeGroup === group.id;
            return (
              <div key={group.id} className="mb-5">
                <a
                  href={`#${group.id}`}
                  className={`block px-2 py-1.5 text-base font-medium uppercase tracking-wide transition-colors ${open ? "text-slate-100" : "text-slate-400 hover:text-slate-100"}`}
                >
                  {group.label}
                </a>
                {open && (
                  <div className="mt-1 space-y-0.5">
                    {group.toc.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className={`block rounded-lg px-2 py-1.5 text-base transition-colors ${
                          active === item.id ? "bg-white/10 font-medium text-slate-100" : "text-slate-300 hover:bg-white/5 hover:text-slate-100"
                        }`}
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 max-w-3xl">
          {/* ABOUT */}
          <section id="about" className="scroll-mt-24 mb-24">
            <p className="mb-3 text-base font-medium uppercase tracking-wide text-orange-400">Company</p>
            <h1 className="mb-6 font-display text-4xl font-medium text-slate-100">About Loofta</h1>
            <p className="mb-12 text-xl leading-relaxed text-slate-300">
              Loofta Inc. builds Loofta Pay: a non-custodial way to send, receive and cash out money across crypto and local
              currencies, without anyone holding your funds but you.
            </p>
            <div className="flex flex-col gap-14">
              <Section id="about-who" title="Who we are">
                <P>
                  Loofta Inc. is a Delaware corporation. We build payment tools for people who get paid in many places at
                  once: creators, freelancers, web3 contributors and distributed teams. Our product, Loofta Pay, lives at
                  pay.loofta.xyz.
                </P>
                <P>
                  We are a small team and we ship fast. Most of what we build comes from watching real people lose time and
                  money to slow, expensive, confusing payment rails.
                </P>
              </Section>
              <Section id="about-why" title="Why we exist">
                <P>
                  Getting paid across borders is still painful. Wire fees eat a chunk of every transfer, platforms hold your
                  money for days, and a lot of people are asked to create an account or a wallet before they can even receive
                  what they earned.
                </P>
                <P>
                  We think you should be able to share a link, get paid in the token you want, and move it to your own wallet
                  or out to cash in a few taps. No invoice chasing, no seed phrases to explain, no gatekeeping.
                </P>
              </Section>
              <Section id="about-what" title="What you can do">
                <UL
                  items={[
                    <><strong>Send and receive.</strong> Pay anyone by email, username or social handle. They claim it from a link, with no wallet address to copy.</>,
                    <><strong>Payment links.</strong> Create a link for a fixed amount and share it anywhere. Payers can use any supported token, a card or Naira.</>,
                    <><strong>Cash out.</strong> Withdraw to USD through Peer Cash, to Naira through PAJ Cash, or to any crypto.</>,
                    <><strong>Private payments.</strong> Hide amounts and wallets on-chain using MagicBlock.</>,
                    <><strong>Giveaways and rewards.</strong> Run escrow-funded giveaways with a verifiable on-chain draw, and earn rewards for using the app.</>,
                  ]}
                />
              </Section>
              <Section id="about-custody" title="Non-custodial by design">
                <P>
                  Your funds stay in wallets you control. Loofta never holds your keys and we are not a bank, an exchange or a
                  custodian. When you sign in, an embedded wallet is created for you and unlocked with a passkey, so there is no
                  12-word phrase to lose.
                </P>
                <P>
                  That is also why some things are your responsibility: blockchain transactions cannot be reversed, and we cannot
                  recover funds sent to a wrong address. The Terms of Service below spell this out in full.
                </P>
              </Section>
              <Section id="about-partners" title="Partners">
                <P>
                  We do not do everything ourselves. We work with specialised partners for swaps and bridging (NEAR Intents),
                  private payments (MagicBlock), wallets and sign-in (Privy), card on-ramps (MoonPay and Coinbase), and fiat
                  off-ramps (Peer and PAJ Cash). We try to be clear about who does what at every step, and each partner&apos;s own
                  terms apply to the part of the flow they run.
                </P>
              </Section>
              <Section id="about-company" title="Company details">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-lg text-slate-400">
                  <p className="mb-1 font-medium text-slate-100">Loofta Inc.</p>
                  <p>A Delaware corporation</p>
                  <p>131 Continental Dr, Suite 305</p>
                  <p>Newark, DE 19713, USA</p>
                  <p className="mt-2">Website: <a href="https://loofta.xyz" className={link}>loofta.xyz</a></p>
                </div>
              </Section>
              <Section id="about-support" title="Support">
                <P>
                  Questions, problems with a payment, or a legal request? Email{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a> or message us in the{" "}
                  <a href="https://t.me/looftapay" target="_blank" rel="noopener noreferrer" className={link}>Telegram support chat</a>.
                </P>
              </Section>
            </div>
          </section>

          {/* TERMS */}
          <section id="terms" className="scroll-mt-24 mb-24">
            <p className="mb-3 text-base font-medium uppercase tracking-wide text-orange-400">Legal</p>
            <h2 className="mb-3 font-display text-4xl font-medium text-slate-100">Terms of Service</h2>
            <p className="mb-8 text-base text-slate-500">Effective date: {TERMS_EFFECTIVE}</p>
            <div className="mb-12 rounded-2xl border border-white/10 bg-white/5 p-6 text-lg leading-relaxed text-slate-400">
              Please read these Terms of Service carefully before using Loofta Pay. By accessing or using the Service, you
              agree to be bound by these Terms. If you do not agree, do not use the Service.
            </div>
            <div className="flex flex-col gap-14">
              <TermsSections />
            </div>
          </section>

          {/* PRIVACY */}
          <section id="privacy" className="scroll-mt-24">
            <p className="mb-3 text-base font-medium uppercase tracking-wide text-orange-400">Legal</p>
            <h2 className="mb-3 font-display text-4xl font-medium text-slate-100">Privacy Policy</h2>
            <p className="mb-8 text-base text-slate-500">Effective date: {PRIVACY_EFFECTIVE}</p>
            <div className="mb-12 rounded-2xl border border-white/10 bg-white/5 p-6 text-lg leading-relaxed text-slate-400">
              Loofta Inc., a Delaware corporation with a registered address at 131 Continental Dr, Suite 305, Newark, DE
              19713, USA, respects your privacy. This policy explains what we collect when you use Loofta Pay, how we use it,
              and your rights. We are a non-custodial service and we never hold your funds. We aim to collect only the
              minimum data needed to run the Service.
            </div>
            <div className="flex flex-col gap-14">
              <PrivacySections />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
