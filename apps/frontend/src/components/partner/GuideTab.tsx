"use client";

import type { ReactNode } from "react";
import { Card, PageHeader } from "./ui";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FFEDE5] text-[14px] font-bold text-[#E8461A]">{n}</span>
      <div className="min-w-0">
        <div className="text-[16px] font-semibold text-[#1D1D1F]">{title}</div>
        <div className="mt-1 text-[15px] leading-[1.6] text-[#4F4F57]">{children}</div>
      </div>
    </li>
  );
}

function Para({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-3 last:mb-0">{children}</p>;
}

/** What the partner product is and how money moves through it, in plain words. Shown in the portal and while an application is reviewed. */
export function GuideContent() {
  return (
    <div className="flex flex-col gap-5">
      <Card title="What this is">
        <Para>Pay many people at once, by email, in USDC. You list who gets what, your team approves, and each person gets an email. They open a page with your name and logo and choose how to take the money: USDC to a wallet, cash to a bank account, a peer to peer cash out, or another token.</Para>
        <Para>You never need their wallet address, and they never need to know anything about crypto to be paid.</Para>
      </Card>

      <Card title="Getting access">
        <Para>Every company is reviewed by hand before it goes live. This keeps the product safe for the people you pay. When you apply we look at your website, what you pay for and roughly how much.</Para>
        <Para>Until you are approved you can finish your application and read this page. Creating a company wallet, API keys, payouts, recipients and team invites open the moment you are approved. Your name and logo are not shown to anyone until then.</Para>
        <Para>If we need more information or say no, you will see our note on the Overview. We can also pause a company later if something looks wrong, and a paused company cannot send anything.</Para>
      </Card>

      <Card title="From payout to cash in hand">
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          <Step n={1} title="Add recipients">Add people by email, import a file, or let us pull a list from your own URL. Put them in groups, and a person can be in more than one.</Step>
          <Step n={2} title="Create a payout">Choose recipients and amounts, or send the same list from your own server with the API. Large payouts can need a second person to approve, so nobody can send a big amount alone.</Step>
          <Step n={3} title="Fund it from your company wallet">Your company wallet is controlled by your team. Members sign, and a payout only leaves once enough of them have. Loofta cannot move money out of it.</Step>
          <Step n={4} title="Recipients get an email">Each person opens your branded page, signs in with their email and picks how to take the money.</Step>
          <Step n={5} title="They cash out">USDC to a wallet arrives straight away. Bank and card cash outs and the other routes take as long as that route takes, and the page shows the status and lets them cancel before they commit.</Step>
        </ol>
      </Card>

      <Card title="Fees">
        <Para>There are two fees. On the withdraw page they are listed separately, except for Private P2P, where the person only sees the amount they receive. Loofta takes $0.05 plus 0.3% on every cash out, whichever way the person takes the money. Private P2P cash-outs start at $10. You can add your own fee on top, a flat amount, a percentage, or both. Your fee can never be more than a quarter of what the person withdraws.</Para>
        <Para>Your fee is paid to the fee wallet you choose. Changing that wallet takes 24 hours to apply, so a stolen login cannot redirect your earnings at once. You can also switch off any cash out route you do not want to offer.</Para>
      </Card>

      <Card title="Your team">
        <Para>Owners run everything, including the fee wallet and the approval limit. Admins manage payouts, recipients, the team and keys. Payers can draft payouts. Viewers can look but not change anything. Every action is written to an audit log.</Para>
      </Card>

      <Card title="API and webhooks">
        <Para>Once approved you can create up to three API keys. A key can open a portal session for your own users, and, if you turn it on, draft payout batches. A key can never approve or fund a payout: a signed in owner or admin approves, and your company wallet signers sign.</Para>
        <Para>Webhooks tell your server when a batch is ready to fund and when a payout is funded, claimed or withdrawn. Each one is signed with a secret so you can check it came from us.</Para>
      </Card>

      <Card title="Safety">
        <Para>Companies are approved by hand, keys are scoped, money needs your team's signatures, fees follow a fixed cap, and every action is logged. If you ever see something you do not recognise, remove the key or member involved and contact support.</Para>
      </Card>
    </div>
  );
}

export function GuideTab() {
  return (
    <div>
      <PageHeader title="How it works" blurb="From applying to paying people, in plain words." />
      <GuideContent />
    </div>
  );
}
