"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { GUIDE_NAV } from "./guideNav";

// Must be absolute, not a relative "/app" — this page is served from the marketing domain
// (loofta.xyz), which has no session/cookies of its own. A relative link would load a logged-out
// app shell there instead of taking the user to pay.loofta.xyz, where they're actually signed in.
const APP_URL = `${process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.xyz"}/app`;

function Cta({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-1.5 text-base font-semibold text-orange-400 hover:text-orange-300 transition-colors">
      {label}
      <span>→</span>
    </a>
  );
}

function ProviderChip({ logo, name }: { logo: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-2 pr-3.5 py-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" className="w-5 h-5 object-contain shrink-0" />
      <span className="text-base font-medium text-slate-200">{name}</span>
    </span>
  );
}

function ProviderRow({ providers }: { providers: { logo: string; name: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2 my-2">
      {providers.map((p) => (
        <ProviderChip key={p.name} logo={p.logo} name={p.name} />
      ))}
    </div>
  );
}

function Card({ slug, title, body, onNavigate }: { slug: string; title: string; body: string; onNavigate: (slug: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(slug)}
      className="text-left rounded-xl border border-white/10 bg-white/5 p-5 hover:bg-white/[0.08] hover:border-white/20 transition-colors"
    >
      <h3 className="text-white font-semibold text-lg font-display mb-1.5">{title}</h3>
      <p className="text-slate-400 text-base leading-relaxed">{body}</p>
    </button>
  );
}

function Overview({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">What you can do on Loofta</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-8">
        Loofta is how creators, freelancers, and distributed teams send and receive money —
        across chains, without exposing a wallet address or payment history to the public. This
        is a map of everything the app does. Looking for the API instead? Head to{" "}
        <a href="/docs" className="text-orange-400 hover:underline">developer docs</a>.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card slug="send" title="Send a payment" body="Pay anyone by email, username, or social handle — no wallet address needed." onNavigate={onNavigate} />
        <Card slug="payment-links" title="Payment links" body="Get paid without an invoice or asking the payer to sign up." onNavigate={onNavigate} />
        <Card slug="terminal" title="Terminal" body="Send money by typing it out, like a message — to one person or many." onNavigate={onNavigate} />
        <Card slug="deposit" title="Deposit" body="Top up your balance from any token, any chain." onNavigate={onNavigate} />
        <Card slug="withdraw" title="Withdraw" body="Cash out to Naira, USD, or any crypto." onNavigate={onNavigate} />
        <Card slug="megapot" title="Megapot" body="A daily-draw lottery, played from Solana, with a private-entry option." onNavigate={onNavigate} />
        <Card slug="giveaways" title="Giveaways" body="Escrow-funded prize pools with a provably random, on-chain draw." onNavigate={onNavigate} />
        <Card slug="privacy" title="Privacy" body="How Loofta hides amounts and wallets on-chain using MagicBlock." onNavigate={onNavigate} />
      </div>
    </article>
  );
}

function Page({ title, logo, children }: { title: string; logo?: string; children: React.ReactNode }) {
  return (
    <article>
      <div className="flex items-center gap-3 mb-6">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="w-9 h-9 object-contain shrink-0" />
        )}
        <h1 className="text-3xl font-medium text-slate-100">{title}</h1>
      </div>
      <div className="flex flex-col gap-4 text-base text-slate-400 leading-relaxed [&_strong]:text-slate-200 [&_strong]:font-medium">
        {children}
      </div>
    </article>
  );
}

function GuideContent({ slug, onNavigate }: { slug: string; onNavigate: (slug: string) => void }) {
  switch (slug) {
    case "send":
      return (
        <Page title="Send a payment">
          <p>Pay anyone by <strong>email, username, or social handle</strong> — Loofta resolves it to a wallet for you, so there's no address to copy or double-check.</p>
          <p>Send from your Loofta balance, or connect a wallet and pay directly from it. Every payment can go out <strong>public</strong> (a plain on-chain transfer) or <strong>private</strong> (amount and wallet shielded — see how that works below).</p>
          <p>The recipient doesn't need an account yet: they get a claim link, and it lands in their balance the moment they sign in with the email or handle it was sent to.</p>
          <Cta href={APP_URL} label="Send a payment" />
        </Page>
      );
    case "payment-links":
      return (
        <Page title="Payment links">
          <p>Create a link for a fixed amount and share it anywhere — a DM, an invoice, a tweet. Whoever pays it doesn't need a Loofta account.</p>
          <p>They can pay as a guest with <strong>any token on any supported chain</strong>, a <strong>credit card</strong>, or <strong>Naira</strong> — it's converted automatically, so you always receive exactly the amount due.</p>
          <p>Every payment link also has a checkout page you can point customers to directly, and an API for generating links programmatically.</p>
          <Cta href="/payment-links" label="Learn more about payment links" />
        </Page>
      );
    case "terminal":
      return (
        <Page title="Terminal">
          <p>Terminal is a chat box for sending money — type what you want to happen ("send $20 to alice@x.com") instead of filling out a form.</p>
          <p>It can split a payment across <strong>multiple recipients at once</strong>, and it can <strong>gift a Megapot ticket</strong> directly from the conversation, in place of a plain cash payment.</p>
          <p>Non-custodial: you always confirm the exact payment before anything sends — Terminal builds the transaction, it doesn't sign or send anything on its own.</p>
          <Cta href={`${APP_URL}/terminal`} label="Open Terminal" />
        </Page>
      );
    case "deposit":
      return (
        <Page title="Deposit">
          <p>Top up your Loofta balance from any token on any supported chain — it bridges in and lands as USDC, ready to spend or send.</p>
          <p>Or skip crypto entirely and fund it directly with fiat:</p>
          <ProviderRow
            providers={[
              { logo: "/images/icons/moonpay-logo.svg", name: "MoonPay — card" },
              { logo: "/images/icons/coinbase-logo.png", name: "Coinbase — card, bank" },
              { logo: "/images/icons/paj-cash-logo.svg", name: "PAJ Cash — Naira" },
            ]}
          />
          <p>There's also a private deposit path for funding your balance without that top-up showing up as a plain public transfer.</p>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mt-2">
            <p className="text-slate-200 font-medium text-base mb-1">Secured by passkeys, not a seed phrase</p>
            <p>
              Loofta's embedded wallet is unlocked with a <strong>passkey</strong> — Face ID, Touch ID, or your
              device's screen lock — instead of a 12-word phrase you have to write down and could lose. It's
              what confirms every deposit and payment you make. (This is also the security feature our Blink
              rewards program was built to get people to set up.)
            </p>
          </div>
          <Cta href={`${APP_URL}?balance=topup`} label="Open balance" />
        </Page>
      );
    case "withdraw":
      return (
        <Page title="Withdraw">
          <p>Cash out however fits — Loofta doesn't lock you into one rail:</p>
          <ProviderRow
            providers={[
              { logo: "/images/icons/peer-logo.svg", name: "Peer Cash — USD" },
              { logo: "/images/icons/paj-cash-logo.svg", name: "PAJ Cash — Naira" },
            ]}
          />
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Peer Cash</strong> — a peer-to-peer off-ramp (built on Peer.xyz) that pays out straight to <strong>Venmo, Cash App, Revolut, or Zelle</strong>, in USD. No bank details to enter: just the username or handle for whichever app you use, and a real person on the other side of the network fills the order at the live rate, zero spread.
            </li>
            <li>
              <strong>PAJ Cash</strong> — for Naira. Set it up once by giving your Nigerian bank account details (bank, account number), and after that every withdrawal usually lands in it within seconds.
            </li>
            <li><strong>Any token</strong> — bridge out to another chain or swap to a different asset.</li>
            <li><strong>SOL</strong> — swap your balance to SOL and withdraw directly to a Solana wallet.</li>
          </ul>
          <Cta href={`${APP_URL}?balance=withdraw`} label="Withdraw" />
        </Page>
      );
    case "megapot":
      return (
        <Page title="How Megapot works" logo="/images/megapot/logo.svg">
          <p>Megapot is a lottery that runs on Base, playable from Solana — Loofta bridges your ticket purchase over automatically, so you never have to leave the app or hold ETH for gas.</p>
          <p>Draws happen <strong>daily</strong>. Buy a ticket publicly, or pay for it with a MagicBlock private transfer so the purchase itself isn't a plain public payment.</p>
          <p>Wins are tracked automatically — small wins can be played forward into another ticket, larger ones can be withdrawn.</p>
          <Cta href={`${APP_URL}/megapot`} label="Play Megapot" />
        </Page>
      );
    case "gift-tickets":
      return (
        <Page title="Gift a ticket" logo="/images/megapot/logo.svg">
          <p>Send someone a Megapot ticket instead of cash — from the Megapot page directly, or by asking Terminal to gift one in chat.</p>
          <p>They get a claim link the same way any other payment works; claiming it enters the ticket in their name for the next draw.</p>
          <Cta href={`${APP_URL}/megapot`} label="Gift a ticket" />
        </Page>
      );
    case "rewards":
      return (
        <Page title="Rewards">
          <p>Partner projects run campaigns on Loofta — complete a quest (like making a payment, or trying a private transfer) and earn whatever that campaign is paying out.</p>
          <p>Active campaigns are shown on the Rewards page; what's available changes as partners launch and wrap up campaigns.</p>
          <Cta href={`${APP_URL}/rewards`} label="See active rewards" />
        </Page>
      );
    case "giveaways":
      return (
        <Page title="Giveaways">
          <p>Anyone can run a giveaway: fund the prize pool upfront into <strong>escrow</strong>, set the entry rule (e.g. a quote-tweet), and let people enter.</p>
          <p>Winners are picked by a <strong>random draw secured by MagicBlock VRF</strong> — verifiable on-chain randomness, not a pick made by hand — either as a weighted raffle across all entries, or a straight draw of N winners.</p>
          <p>Payout to winners is automatic once the draw runs; nothing sits with the organizer to distribute manually.</p>
          <Cta href={`${APP_URL}/rewards/giveaways`} label="See giveaways" />
        </Page>
      );
    case "privacy":
      return (
        <Page title="How private payments work">
          <p>Private payments run through <strong>MagicBlock</strong> — a private ephemeral rollup that executes the transfer off the main chain, backed by a <strong>TEE (trusted execution environment)</strong>, before settling the result back on Solana.</p>
          <p>The amount and the wallets involved aren't broadcast on the public ledger the way a normal transfer is. Settlement can also be <strong>split and delayed</strong> — breaking the transaction into pieces that land at different times — so there's no single, timestamped, full-amount transfer for anyone watching an address to correlate back to you.</p>
          <p>It works from your Loofta balance or directly from a connected wallet, and you always see the exact fee before you pay.</p>
        </Page>
      );
    default:
      return <Overview onNavigate={onNavigate} />;
  }
}

function GuideBodyInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeSlug, setActiveSlug] = useState(() => searchParams.get("p") ?? "");

  const navigate = useCallback(
    (slug: string) => {
      setActiveSlug(slug);
      router.replace(slug ? `/how-it-works?p=${slug}` : "/how-it-works", { scroll: false });
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [router],
  );

  const content = useMemo(() => <GuideContent slug={activeSlug} onNavigate={navigate} />, [activeSlug, navigate]);

  return (
    <main className="min-h-screen bg-[#111114] text-slate-100">
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-10 pb-24 flex gap-10">
        <nav className="hidden md:block w-60 shrink-0 sticky top-24 self-start">
          <div className="mb-6">
            <p className="text-base font-medium text-slate-300 uppercase tracking-wide mb-2">How Loofta works</p>
          </div>
          {GUIDE_NAV.map((group) => (
            <div key={group.section} className="mb-6">
              <p className="text-base font-medium text-slate-400 uppercase tracking-wide mb-2 px-2">{group.section}</p>
              <div className="space-y-0.5">
                {group.pages.map((page) => {
                  const active = activeSlug === page.slug;
                  return (
                    <button
                      key={page.slug || "overview"}
                      type="button"
                      onClick={() => navigate(page.slug)}
                      className={[
                        "block w-full text-left px-2 py-1.5 rounded-lg text-base transition-colors",
                        active ? "bg-white/10 text-slate-100 font-medium" : "text-slate-300 hover:text-slate-100 hover:bg-white/5",
                      ].join(" ")}
                    >
                      {page.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 max-w-2xl">{content}</div>
      </div>
    </main>
  );
}

export default function GuideBody() {
  return (
    <>
      <MinimalHeader />
      <Suspense fallback={null}>
        <GuideBodyInner />
      </Suspense>
      <Footer />
    </>
  );
}
