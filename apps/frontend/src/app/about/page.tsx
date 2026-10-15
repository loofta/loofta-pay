import type { Metadata } from "next";
import Link from "next/link";
import { MinimalHeader } from "@/components/layout/MinimalHeader";

export const metadata: Metadata = {
  title: "About Loofta",
  description:
    "Loofta Inc. is a Delaware company building non-custodial payment tools for creators, freelancers and distributed teams.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#111114] px-6 py-16 text-slate-100 antialiased md:px-10">
        <div className="mx-auto max-w-[760px]">
          <p className="mb-3 font-grotesk text-sm uppercase tracking-widest text-[#FF1301]">Company</p>
          <h1 className="mb-6 font-display text-[clamp(2rem,5vw,3.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-slate-100">
            About Loofta
          </h1>

          <div className="flex flex-col gap-5 font-grotesk text-base leading-[1.75] text-slate-400">
            <p>
              Loofta Inc. is a Delaware corporation that builds Loofta Pay, a non-custodial way to send, receive and cash
              out money across crypto and local currencies. We started Loofta because getting paid across borders is still
              slow, expensive and full of friction, especially for creators, freelancers, web3 contributors and
              distributed teams.
            </p>
            <p>
              With Loofta you can share a payment link or claim page, get paid in the token you want, and move it to your
              own wallet or out to cash. Your funds stay in wallets you control. We never hold your keys, and we are not a
              bank or a custodian.
            </p>
            <p>
              We work with third-party partners for swaps, bridging, private payments and fiat off-ramps, and we try to be
              clear about who does what at every step.
            </p>
          </div>

          <div className="mt-12 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 font-grotesk text-[14px] text-slate-400">
            <h2 className="mb-3 font-display text-base font-medium text-slate-100">Company details</h2>
            <p className="text-slate-100 font-medium mb-1">Loofta Inc.</p>
            <p>A Delaware corporation</p>
            <p>131 Continental Dr, Suite 305</p>
            <p>Newark, DE 19713, USA</p>
            <p className="mt-2">
              Email:{" "}
              <a href="mailto:hello@loofta.xyz" className="text-[#FF1301] hover:underline">hello@loofta.xyz</a>
            </p>
          </div>

          <div className="mt-16 flex items-center justify-between border-t border-white/[0.06] pt-8">
            <Link href="/terms" className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors">
              Terms of Service
            </Link>
            <Link href="/privacy" className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
