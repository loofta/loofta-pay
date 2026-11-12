import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { DOCS_NAV } from "../docsNav";
import { DocsToc } from "../DocsToc";

const inter = Inter({ subsets: ["latin"], display: "swap" });

const TITLE = "Stake to win: how it works | Loofta Docs";
const DESCRIPTION =
  "Stake USDC from your Loofta balance and join a weekly prize draw funded by yield. Your principal stays yours and you can withdraw any time. Powered by Ample.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/docs/stake" },
  openGraph: { type: "article", url: "/docs/stake", siteName: "Loofta Pay", title: TITLE, description: DESCRIPTION },
};

const STEPS = [
  { t: "Stake", d: "Add USDC from your Solana wallet. It takes a couple of taps, there is nothing else to set up and no gas to hold. The minimum is $1." },
  { t: "Get tickets", d: "Your savings earn tickets for the current weekly cycle. Tickets represent your eligible participation and set your chance of receiving a payout. You get about 100 tickets per $1 held, averaged over the week, so a bigger stake means more tickets. Bonuses for staying, for not having won yet and for adding $10 or more every week can lift that further, up to 1.91x." },
  { t: "Join the weekly draw", d: "The protocol runs in weekly cycles. Each week it distributes accrued protocol yield to winners. The countdown on the Stake page shows when the next draw runs." },
  { t: "Win, claim, withdraw", d: "Prizes show up on the Stake page ready to claim, and a claimed prize is added to your savings. You can withdraw your USDC whenever you like." },
];

const FAQ = [
  { q: "Is this a lottery? Do I pay to enter?", a: "No ticket is bought. You stake USDC and keep ownership of it. The prizes come from the yield the pooled deposits earn." },
  { q: "Can I lose my deposit?", a: "Your USDC sits in an Ample vault and stays yours. Like any DeFi product there is smart contract risk, so only stake what you are comfortable with. Prizes are never guaranteed, and you may go many weeks without winning." },
  { q: "Can I withdraw any time?", a: "Yes. There is no lockup. Open the Withdraw tab on the Stake page, or use the stake option offered on any Loofta withdrawal. Withdrawing lowers your tickets for later draws." },
  { q: "What does Loofta charge?", a: "Loofta charges 0.05% when you add money and 0.05% when you withdraw, so $100 costs 5 cents each way. Moving money between your wallet and the savings pool also carries a small bridge cost, about $0.02 each way, and Loofta pays the network fees. Any change will be written here first." },
  { q: "How are my chances worked out?", a: "By tickets. The Stake page shows an estimate of your weekly odds based on your stake and the pool size, and the exact ticket count once you are staked. Treat the estimate as a guide, not a promise." },
  { q: "Who runs the vault?", a: "Ample (ample.money). Loofta is the interface: the pool and the draw are Ample's, and Loofta moves your money in and out for you. For contracts, audits and the protocol's own rules, read Ample's documentation." },
  { q: "Which chain and token?", a: "You add and withdraw USDC on Solana. Loofta moves it to and from the pool for you, so you never handle another network." },
  { q: "What are the ticket bonuses and streaks?", a: "Your tickets can be lifted by three bonuses that stack up to 1.91x: loyalty for holding, luck for every week you have not won, and a streak for adding $10 or more every week. Only deposits of $10 or more in a week count toward the streak, and a missed week resets it. The Stake page shows each bonus and your streak, as estimates until the draw." },
];

const TOC = [
  { id: "overview", title: "Overview" },
  { id: "how-it-works", title: "How it works" },
  { id: "payouts", title: "How payouts work" },
  { id: "security", title: "Security" },
  { id: "why-loofta", title: "Why stake in Loofta" },
  { id: "things-to-know", title: "Things to know" },
  { id: "faq", title: "FAQ" },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="group mt-12 scroll-mt-24 border-t border-white/10 pt-10 text-2xl font-bold tracking-tight">
      <a href={`#${id}`} className="no-underline">{children}</a>
    </h2>
  );
}

export default function StakeDocsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <>
      <MinimalHeader />
      <main className={`${inter.className} min-h-screen bg-[#111114] text-slate-100 antialiased`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <div className="mx-auto flex max-w-7xl gap-10 px-4 md:px-8 pt-8 pb-24">
          {/* Left: site navigation */}
          <nav aria-label="Docs" className="hidden lg:block w-64 shrink-0 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
            <div className="mb-5">
              <p className="mb-2 px-3 text-base font-semibold uppercase tracking-wide text-slate-300">Products</p>
              <Link href="/docs/stake" className="block rounded-lg bg-[#FF5A1A]/10 px-3 py-2 text-base font-medium text-[#FF8A3D]">
                Stake to win
              </Link>
              <div className="mt-1 ml-3 border-l border-white/10">
                {TOC.map((t) => (
                  <a key={t.id} href={`#${t.id}`} className="block py-1.5 pl-4 text-base text-slate-300 hover:text-slate-200">{t.title}</a>
                ))}
              </div>
            </div>
            {DOCS_NAV.map((g) => (
              <div key={g.section} className="mb-5">
                <p className="mb-2 px-3 text-base font-semibold uppercase tracking-wide text-slate-300">{g.section}</p>
                {g.pages.map((pg) => (
                  <Link
                    key={pg.slug || "intro"}
                    href={pg.slug ? `/docs?p=${pg.slug}` : "/docs"}
                    className="block rounded-lg px-3 py-2 text-base text-slate-100 hover:bg-white/5 hover:text-slate-100"
                  >
                    {pg.title}
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          {/* Center: article */}
          <article className="min-w-0 flex-1 max-w-3xl">
            <p className="text-base text-slate-300">
              <Link href="/docs" className="hover:text-slate-200">Docs</Link>
              <span className="mx-2">/</span>
              <span className="text-slate-200">Stake to win</span>
            </p>
            <h1 id="overview" className="mt-3 scroll-mt-24 text-4xl md:text-5xl font-bold tracking-tight">Stake to win</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-100">
              Put idle USDC to work. Stake from your Loofta balance, get tickets, and take part in a weekly prize draw funded by
              yield. Your principal stays yours and is always available.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/app/stake" className="rounded-full bg-gradient-to-r from-[#FF3D0F] to-[#FF7A2A] px-6 py-3 text-base font-semibold text-white">
                Start staking
              </Link>
              <a href="https://ample.money/docs" target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/15 px-6 py-3 text-base font-semibold text-slate-100 hover:bg-white/5">
                Ample protocol docs
              </a>
            </div>

            <H2 id="how-it-works">How it works</H2>
            <ol className="mt-5 space-y-5">
              {STEPS.map((s, i) => (
                <li key={s.t} className="flex gap-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF5A1A]/15 text-base font-bold text-[#FF8A3D]">{i + 1}</span>
                  <div>
                    <h3 className="text-lg font-semibold">{s.t}</h3>
                    <p className="mt-1 text-base leading-relaxed text-slate-100">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>

            <H2 id="payouts">How payouts work</H2>
            <p className="mt-5 text-base leading-relaxed text-slate-100">
              Prizes are paid from yield, never from other people&apos;s deposits. Here is the weekly cycle, step by step.
            </p>
            <ol className="mt-5 list-decimal space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li><strong className="font-semibold text-white">The prize pool builds up.</strong> Over a 7 day cycle, the yield earned by all the pooled deposits is collected into the weekly prize pool. The pool contains no deposits.</li>
              <li><strong className="font-semibold text-white">Tickets lock at the end of the cycle.</strong> Your tickets come from your time-weighted balance over the cycle: about 100 tickets for every $1 you held, averaged across the week. You need to have held for at least an hour during the cycle to be eligible. Three bonuses multiply your tickets on top of that. <em>Loyalty</em> is 1.05x after one full week held and 1.1x after two, and a withdrawal of more than 10% of your balance resets it. <em>Luck</em> adds 0.02x for every week without a prize, up to 1.4x, and resets when you win. <em>Streak</em> adds 0.02x for every week in a row you add $10 or more, up to 1.24x after 12 weeks, and a missed week resets it. Together they reach 1.91x at most, and the Stake page shows yours with your current streak.</li>
              <li><strong className="font-semibold text-white">The list is sealed before the draw.</strong> The full ticket list is fixed and published as a cryptographic fingerprint (a merkle root) before any winner is picked, so it cannot be changed afterwards.</li>
              <li><strong className="font-semibold text-white">Winners are drawn with verifiable randomness.</strong> The selection uses an on-chain random function with a proof. Your chance on each pick is your tickets divided by all tickets.</li>
              <li><strong className="font-semibold text-white">The pool is split into tiers.</strong> A grand prize, large prizes, mid prizes and a wide base of smaller prizes, so a lot of people win something each week. A person can win at most one prize per tier per week.</li>
              <li><strong className="font-semibold text-white">Results are posted on-chain, then you claim.</strong> Winners appear on the Stake page with a Claim button. One transaction claims the prize and, in Loofta, adds it to your stake. Claims do not expire.</li>
            </ol>
            <p className="mt-5 text-base leading-relaxed text-slate-100">
              The Stake page shows a countdown to the next draw. While a draw is being worked out, winners can appear a little before payouts are final, so give it a moment before claiming.
            </p>

            <H2 id="security">Security</H2>
            <h3 className="mt-5 text-lg font-semibold">Your funds</h3>
            <ul className="mt-3 list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li><strong className="font-semibold text-white">Your own savings account.</strong> Your money sits in a savings account made for you in Ample&apos;s pool. Loofta&apos;s service operates that account on your behalf: it only moves money when you add, withdraw or claim, and a withdrawal always goes back to your own Solana wallet.</li>
              <li><strong className="font-semibold text-white">No lockup.</strong> Withdrawals are open at all times, with no waiting period. Loofta&apos;s 0.05% fee applies when you withdraw, as it does when you add money.</li>
              <li><strong className="font-semibold text-white">Prizes are separate from deposits.</strong> The prize pool is yield only, so paying prizes never touches anyone&apos;s principal.</li>
            </ul>
            <h3 className="mt-6 text-lg font-semibold">The protocol</h3>
            <ul className="mt-3 list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li><strong className="font-semibold text-white">Audited.</strong> Ample&apos;s vault and payout contracts have been reviewed by Pashov Audit Group. Ample publishes the reports in its security documentation.</li>
              <li><strong className="font-semibold text-white">Conservative yield.</strong> Yield comes from overcollateralized lending markets, with no leverage and no directional positions, according to Ample.</li>
              <li><strong className="font-semibold text-white">Fair draw.</strong> The ticket list is sealed before the draw, winners come from verifiable randomness, and results are committed on-chain before any claim.</li>
              <li><strong className="font-semibold text-white">Admin controls.</strong> Ample states that its multisigs use timelocks and high thresholds, with keys kept in cold wallets.</li>
            </ul>
            <h3 className="mt-6 text-lg font-semibold">Risks</h3>
            <ul className="mt-3 list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li>Smart contract bugs, in Ample&apos;s contracts or in the lending markets underneath. Audits reduce this risk but do not remove it.</li>
              <li>A stablecoin losing its peg.</li>
              <li>Temporary low liquidity in the underlying market, which can delay a large withdrawal.</li>
              <li>Prizes are never guaranteed, and you may go many weeks without winning.</li>
            </ul>
            <p className="mt-5 text-base leading-relaxed text-slate-100">
              For contract addresses, the audit reports and the protocol&apos;s own rules, read{" "}
              <a href="https://ample-2.gitbook.io/docs/security-and-risk/overview" target="_blank" rel="noopener noreferrer" className="text-[#FF8A3D] underline underline-offset-4">Ample&apos;s security documentation</a>.
            </p>

            <H2 id="why-loofta">Why stake in Loofta</H2>
            <ul className="mt-5 list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li>One tap from the USDC in your Solana wallet. No second wallet, no bridging to do yourself, no gas to top up.</li>
              <li>Stake a little when you withdraw or cash out. The option appears on every withdrawal path, from $1.</li>
              <li>Withdraw to any wallet, token or bank from the same place you stake.</li>
            </ul>

            <H2 id="things-to-know">Things to know</H2>
            <ul className="mt-5 list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-100 marker:text-slate-300">
              <li>The minimum stake is $1.</li>
              <li>Ticket counts and odds on the Stake page are estimates until Ample confirms them for the cycle.</li>
              <li>Smart contract risk applies. Prizes are not guaranteed.</li>
              <li>The vault, the draw and the rules are Ample&apos;s. This page describes how we present them, and Ample&apos;s documentation is the reference.</li>
            </ul>

            <H2 id="faq">FAQ</H2>
            <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                    {f.q}
                    <span className="text-[#FF7A2A] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-base leading-relaxed text-slate-100">{f.a}</p>
                </details>
              ))}
            </div>

            {/* Prev / next, GitBook style */}
            <div className="mt-14 grid gap-4 sm:grid-cols-2">
              <Link href="/docs" className="rounded-xl border border-white/10 p-4 hover:border-white/25">
                <span className="block text-base text-slate-300">Previous</span>
                <span className="mt-1 block text-lg font-semibold">← Introduction</span>
              </Link>
              <Link href="/app/stake" className="rounded-xl border border-white/10 p-4 text-right hover:border-white/25">
                <span className="block text-base text-slate-300">Try it</span>
                <span className="mt-1 block text-lg font-semibold">Open Stake →</span>
              </Link>
            </div>
          </article>

          {/* Right: on this page */}
          <DocsToc items={TOC} />
        </div>
      </main>
      <Footer />
    </>
  );
}
