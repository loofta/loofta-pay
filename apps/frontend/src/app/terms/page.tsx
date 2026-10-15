import type { Metadata } from "next";
import Link from "next/link";
import { MinimalHeader } from "@/components/layout/MinimalHeader";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Loofta Pay Terms of Service — read our terms before using the non-custodial payment platform.",
};

const EFFECTIVE_DATE = "August 10, 2026";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="mb-4 font-display text-2xl font-medium text-white">{title}</h2>
      <div className="flex flex-col gap-3 font-grotesk text-base leading-[1.75] text-slate-400">
        {children}
      </div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-4">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span className="mt-[8px] h-1 w-1 flex-shrink-0 rounded-full bg-slate-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const TOC = [
  { id: "acceptance", label: "1. Acceptance of Terms" },
  { id: "service", label: "2. Description of Service" },
  { id: "eligibility", label: "3. Eligibility" },
  { id: "accounts", label: "4. Accounts & Identity" },
  { id: "non-custodial", label: "5. Non-Custodial Nature" },
  { id: "fees", label: "6. Fees" },
  { id: "transactions", label: "7. Transactions & Payments" },
  { id: "megapot", label: "8. Megapot & Prize-Based Features" },
  { id: "mystery-pack", label: "9. Mystery Pack" },
  { id: "giveaways", label: "10. Giveaways" },
  { id: "fiat-offramp", label: "11. Fiat Off-Ramp Services" },
  { id: "compliance", label: "12. Compliance Screening" },
  { id: "prohibited", label: "13. Prohibited Uses" },
  { id: "rewards", label: "14. Rewards Program" },
  { id: "third-party", label: "15. Third-Party Services" },
  { id: "ip", label: "16. Intellectual Property" },
  { id: "disclaimer", label: "17. Disclaimers" },
  { id: "liability", label: "18. Limitation of Liability" },
  { id: "indemnification", label: "19. Indemnification" },
  { id: "termination", label: "20. Termination" },
  { id: "governing-law", label: "21. Governing Law" },
  { id: "changes", label: "22. Changes to These Terms" },
  { id: "contact", label: "23. Contact" },
];

export default function TermsPage() {
  return (
    <>
      <MinimalHeader />
    <main className="min-h-screen bg-[#0a0a0c] px-6 py-16 text-white antialiased md:px-10">
      <div className="mx-auto max-w-[760px]">
        {/* header */}
        <div className="mb-12">
          <p className="mb-3 font-grotesk text-sm uppercase tracking-widest text-[#FF1301]">Legal</p>
          <h1 className="mb-4 font-display text-[clamp(2rem,5vw,3.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-white">
            Terms of Service
          </h1>
          <p className="font-grotesk text-[14px] text-slate-500">
            Effective date: {EFFECTIVE_DATE} &nbsp;·&nbsp; Last updated: {EFFECTIVE_DATE}
          </p>
        </div>

        {/* intro callout */}
        <div className="mb-12 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <p className="font-grotesk text-base leading-[1.75] text-slate-400">
            Please read these Terms of Service carefully before using Loofta Pay. By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
          </p>
        </div>

        {/* table of contents */}
        <div className="mb-14 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <h2 className="mb-4 font-display text-base font-medium text-white">Contents</h2>
          <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        {/* sections */}
        <div className="flex flex-col gap-12">
          <Section id="acceptance" title="1. Acceptance of Terms">
            <P>
              These Terms of Service ("Terms") constitute a legally binding agreement between you ("User," "you," or "your") and Loofta Inc., a Delaware corporation with a registered address at 131 Continental Dr, Suite 305, Newark, DE 19713, USA ("Company," "we," "us," or "our"), governing your access to and use of the Loofta Pay application, website, and all related services (collectively, the "Service") available at pay.loofta.xyz and related domains.
            </P>
            <P>
              By creating an account, connecting a wallet, or otherwise accessing the Service, you confirm that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. Your continued use of the Service constitutes ongoing acceptance of any updates to these Terms.
            </P>
          </Section>

          <Section id="service" title="2. Description of Service">
            <P>
              Loofta Pay is a non-custodial payment platform built on the Solana blockchain that enables users to:
            </P>
            <UL items={[
              "Send and receive USDC payments on Solana using shareable payment links, usernames, email addresses, or wallet addresses.",
              "Create reusable payment request links that can be shared with payers.",
              "Deposit supported tokens from other chains into your Loofta balance via third-party cross-chain protocols.",
              "Withdraw USDC to external Solana wallets or to other supported chains via third-party bridge protocols.",
              "Withdraw USDC as Nigerian Naira (NGN) to a linked bank account via a third-party fiat off-ramp partner, where available.",
              "Purchase tickets in Megapot, a third-party, blockchain-based lottery, for a chance to win a prize pool.",
              "Purchase Mystery Packs, a chance-based feature that allocates a randomized number of Megapot tickets.",
              "Create, fund, or enter giveaways distributed through the Service.",
              "View complete transaction history.",
              "Earn rewards through our loyalty and referral program.",
            ]} />
            <P>
              The Service operates on the Solana mainnet. Certain features may be in beta, limited to invited users, or subject to additional restrictions as disclosed in the application.
            </P>
          </Section>

          <Section id="eligibility" title="3. Eligibility">
            <P>To use the Service, you must:</P>
            <UL items={[
              "Be at least 18 years of age, or the age of majority in your jurisdiction if higher.",
              "Have the legal capacity to enter into a binding contract.",
              "Not be located in, organized under the laws of, or ordinarily resident in a jurisdiction subject to comprehensive sanctions administered by the U.S. Office of Foreign Assets Control (OFAC), including but not limited to Cuba, Iran, North Korea, Syria, Russia (as applicable), and the Crimea, Donetsk, and Luhansk regions.",
              "Not be designated on any U.S., EU, UN, or UK sanctions list.",
              "Not be using the Service on behalf of a person or entity that is ineligible.",
            ]} />
            <P>
              By using the Service, you represent and warrant that you meet all eligibility requirements. We reserve the right to restrict access to the Service in any jurisdiction at our sole discretion.
            </P>
            <P>
              Certain features — including Megapot, Mystery Pack, and giveaway features described in Sections 8 through 10 — may be classified as games of chance and may be restricted, illegal, or separately regulated in your jurisdiction. It is solely your responsibility to determine whether your access to and use of these features is lawful where you are located, and we accept no liability for your use of these features in violation of local law.
            </P>
          </Section>

          <Section id="accounts" title="4. Accounts & Identity">
            <P>
              Authentication and identity management for the Service is provided by Privy, Inc. ("Privy"). You may register and log in using your email address or your X (formerly Twitter) account. By logging in, you authorize Privy to create and manage an embedded Solana wallet on your behalf, and you agree to Privy's own terms of service and privacy policy.
            </P>
            <P>
              You are responsible for maintaining the confidentiality of any credentials used to access your account and for all activities that occur under your account. You agree to notify us immediately at hello@loofta.xyz if you suspect any unauthorized use of your account.
            </P>
            <P>
              We link your Privy user identifier to your Loofta profile and transaction history stored in our database. You may also connect an external Solana wallet (e.g., Phantom). You are solely responsible for the security and backup of any external wallet private keys.
            </P>
            <P>
              We reserve the right to suspend or terminate your account if we determine, at our sole discretion, that you have violated these Terms, provided false information, or engaged in any prohibited activity.
            </P>
          </Section>

          <Section id="non-custodial" title="5. Non-Custodial Nature">
            <P>
              <strong className="text-white font-medium">Loofta Pay is a non-custodial service.</strong> We do not hold, control, or take custody of your funds, private keys, or digital assets at any time.
            </P>
            <P>
              Your Solana wallet — whether an embedded wallet created and secured by Privy or an external wallet you connect — is controlled exclusively by you. Loofta facilitates transaction construction and submission on your behalf using keys that you authorize; we do not have the ability to move your funds without your explicit approval for each transaction.
            </P>
            <P>
              As a consequence of our non-custodial architecture:
            </P>
            <UL items={[
              "We cannot reverse, cancel, or recover transactions once they are submitted to the Solana blockchain. Blockchain transactions are generally irreversible.",
              "If you lose access to your wallet credentials or seed phrase, we cannot recover your funds.",
              "We are not responsible for losses resulting from your own actions, errors, or failure to maintain secure access to your wallet.",
              "We are not a bank, payment processor, money transmitter, or financial institution. We do not provide deposit insurance (e.g., FDIC or SIPC coverage).",
            ]} />
          </Section>

          <Section id="fees" title="6. Fees">
            <P>
              Loofta charges a platform fee on each payment transaction. The current fee structure is:
            </P>
            <UL items={[
              "A USDC fee of 10 basis points (0.10%) of the transaction amount.",
              "A network cost component of approximately 0.002 SOL (converted to USD equivalent at the time of the transaction) to cover on-chain transaction costs.",
            ]} />
            <P>
              Fees are displayed to you before you confirm any transaction. We reserve the right to modify our fee structure at any time with reasonable notice. Continued use of the Service after a fee change constitutes acceptance of the new fee structure.
            </P>
            <P>
              In addition to platform fees, Solana network fees ("gas fees") apply to all on-chain transactions. These are separate from, and not retained by, Loofta. Cross-chain deposit and withdrawal operations facilitated by third-party protocols may also incur their own fees, which are disclosed by those protocols at the time of the operation.
            </P>
          </Section>

          <Section id="transactions" title="7. Transactions & Payments">
            <P>
              The primary token supported by the Service is USDC (USD Coin) on the Solana blockchain. By sending or receiving a payment through the Service, you agree that:
            </P>
            <UL items={[
              "You are initiating a real blockchain transaction that, once confirmed, is irreversible.",
              "You have verified all recipient details (address, username, or payment link) before confirming a transaction.",
              "You are responsible for ensuring that any recipient address or entity you are paying is lawful and that you are permitted to make the transfer.",
              "Payment links generated by you may be used by any person with access to the link. You are responsible for distributing your payment links only to intended recipients.",
            ]} />
            <P>
              <strong className="text-white font-medium">Cross-chain deposits:</strong> Deposits from other chains or tokens are facilitated by third-party protocols including Defuse Protocol and Near Intents. These operations are subject to the terms and conditions of those protocols. Loofta does not control cross-chain bridging infrastructure and is not responsible for delays, failures, or losses that occur within those third-party systems.
            </P>
            <P>
              <strong className="text-white font-medium">Withdrawals:</strong> USDC withdrawals to external Solana wallets are processed on-chain. Cross-chain withdrawals (beta) are routed through third-party bridge protocols. Withdrawal addresses are subject to compliance screening as described in Section 12.
            </P>
          </Section>

          <Section id="megapot" title="8. Megapot & Prize-Based Features">
            <P>
              The Service provides access to Megapot, a blockchain-based lottery operated by an independent third-party protocol. You may use USDC held in your Loofta balance to purchase Megapot tickets for a chance to win a prize pool. By purchasing a ticket, you acknowledge and agree that:
            </P>
            <UL items={[
              "Ticket purchases are final once submitted on-chain and are non-refundable, including if you do not win.",
              "Winners are selected through a drawing mechanism operated and controlled by Megapot, not by Loofta. We do not control, operate, guarantee, or take responsibility for the outcome, timing, fairness, or integrity of any drawing.",
              "Purchasing one or more tickets does not guarantee that you will win any prize. Your odds of winning depend on the total number of tickets sold in a given round and other factors outside our control.",
              "Any promotional mechanics described in the application (such as bonus tickets, multipliers, or free entries) are subject to change or removal at any time and are not a contractual entitlement.",
              "Prize payouts, if any, are distributed by Megapot according to its own rules and timelines. Delays or failures in that protocol are not attributable to Loofta.",
              "We reserve the right to modify, suspend, restrict, or discontinue access to Megapot features at any time, including on a jurisdiction-by-jurisdiction basis, without liability to you.",
            ]} />
            <P>
              Megapot and other prize-based features may be considered games of chance and may be illegal, restricted, or separately licensed or taxed in certain jurisdictions. You represent that your participation is lawful in your jurisdiction and you assume all legal and financial risk associated with your participation.
            </P>
          </Section>

          <Section id="mystery-pack" title="9. Mystery Pack">
            <P>
              Mystery Pack is a chance-based feature that, in exchange for a fixed USDC payment, allocates you a randomized number of Megapot tickets (as described in Section 8) within a disclosed range. The specific number of tickets you receive is determined at random at the time of purchase and is not known to you in advance.
            </P>
            <UL items={[
              "Mystery Pack purchases are final and non-refundable once submitted.",
              "The value of the tickets you receive may be more or less than the amount paid; we do not guarantee any minimum or expected value.",
              "Available Mystery Pack tiers, pricing, and ticket ranges are subject to change or discontinuation at any time and are disclosed in the application at the time of purchase.",
              "All disclaimers, risk acknowledgments, and jurisdictional restrictions set out in Section 8 apply equally to Mystery Pack purchases.",
            ]} />
          </Section>

          <Section id="giveaways" title="10. Giveaways">
            <P>
              The Service allows users ("sponsors") to create and fund giveaways that other users may enter, including giveaways tied to engagement with a linked X (Twitter) post. By creating, funding, or entering a giveaway, you agree that:
            </P>
            <UL items={[
              "Sponsors are solely responsible for funding the giveaway prize, setting eligibility criteria, and complying with any laws applicable to sweepstakes, contests, or promotions in the jurisdictions where the giveaway is offered.",
              "Loofta acts only as a technical platform that facilitates entry verification and prize distribution; we are not the sponsor of any giveaway unless expressly stated otherwise.",
              "Winner selection is performed using the mechanism disclosed in the application (which may rely on on-chain randomness or third-party data, such as X API data, to verify entries). We do not guarantee the availability, accuracy, or continued operation of any third-party data source used to verify entries.",
              "We reserve the right to remove, cancel, or refuse to process any giveaway that we believe, in our sole discretion, violates these Terms, applicable law, or the policies of any third-party platform (including X).",
              "Loofta is not liable for a sponsor's failure to fund or fulfill a prize, for disputes between sponsors and entrants, or for entries that fail to be recorded due to third-party platform outages or rate limits.",
            ]} />
          </Section>

          <Section id="fiat-offramp" title="11. Fiat Off-Ramp Services">
            <P>
              Where available, the Service allows eligible users to convert USDC into Nigerian Naira (NGN) and withdraw the proceeds to a linked Nigerian bank account through a third-party financial partner. This feature is currently offered on a limited, best-efforts basis and may not be available to all users at all times.
            </P>
            <UL items={[
              "Fiat off-ramp transactions are subject to the third-party partner's own identity verification (KYC), anti-money-laundering checks, terms of service, and privacy policy, which you must separately accept to use this feature.",
              "To facilitate a fiat off-ramp transaction, we share your wallet address and transaction details with our third-party partner. The partner may independently collect additional information from you, including bank account details and identity documents, which Loofta does not control.",
              "Settlement times for bank transfers are determined by our third-party partner and local banking infrastructure and are outside our control. We do not guarantee any particular settlement time.",
              "Loofta is not a licensed money transmitter, payment service provider, or bank in Nigeria or any other jurisdiction. Regulated fiat payment activity is performed by our third-party partner, not by Loofta.",
              "We may suspend, limit, or discontinue fiat off-ramp availability at any time, including due to partner outages, regulatory changes, or risk decisions, without liability to you.",
            ]} />
          </Section>

          <Section id="compliance" title="12. Compliance Screening">
            <P>
              To help prevent the use of the Service for money laundering, sanctions evasion, or other illegal purposes, we use third-party compliance services including Range Protocol to screen wallet addresses involved in transactions, particularly withdrawals.
            </P>
            <P>
              By using the Service, you consent to the screening of wallet addresses you use in connection with the Service against sanctions lists, risk databases, and other compliance tools. We may, at our sole discretion and without prior notice, decline to process or block transactions involving addresses identified as high-risk or sanctioned.
            </P>
            <P>
              We comply with applicable anti-money laundering (AML) and know-your-customer (KYC) regulations to the extent required by law. We reserve the right to request additional identity verification information from users if required by applicable law or our compliance obligations.
            </P>
          </Section>

          <Section id="prohibited" title="13. Prohibited Uses">
            <P>You agree not to use the Service to:</P>
            <UL items={[
              "Violate any applicable law, regulation, or treaty, including anti-money laundering laws, sanctions regulations, and counter-terrorism financing laws.",
              "Send or receive payments in connection with illegal activity, including fraud, trafficking, or the purchase or sale of illegal goods or services.",
              "Evade taxes or regulatory obligations.",
              "Engage in market manipulation, wash trading, or any form of price manipulation.",
              "Attempt to circumvent our compliance screening or access controls.",
              "Use the Service in a manner that could disable, overburden, or impair the Service or servers.",
              "Introduce malicious code, viruses, or other harmful components.",
              "Reverse engineer, decompile, or disassemble any part of the Service.",
              "Use automated scripts or bots to access the Service without our express written permission.",
              "Impersonate any person or entity or misrepresent your affiliation.",
            ]} />
            <P>
              Violation of this section may result in immediate account termination, reporting to law enforcement, and/or civil or criminal liability.
            </P>
          </Section>

          <Section id="rewards" title="14. Rewards Program">
            <P>
              Loofta may offer a rewards, loyalty, or referral program from time to time. Rewards are at our sole discretion, have no guaranteed monetary value, and may be modified, suspended, or terminated at any time without notice. Rewards cannot be redeemed for cash unless explicitly stated. We reserve the right to void rewards obtained through abuse, fraud, or violation of these Terms.
            </P>
          </Section>

          <Section id="third-party" title="15. Third-Party Services">
            <P>
              The Service integrates with or relies upon a number of third-party services, including but not limited to:
            </P>
            <UL items={[
              "Privy, Inc. — identity and embedded wallet management.",
              "Supabase — database and user data storage.",
              "Helius — Solana RPC infrastructure.",
              "Range Protocol — wallet address compliance screening.",
              "Defuse Protocol / Near Intents — cross-chain deposit and withdrawal routing.",
              "MagicBlock — ephemeral rollup infrastructure used for private and accelerated on-chain transactions.",
              "PAJ Cash — third-party fiat off-ramp partner for Nigerian Naira withdrawals.",
              "Vercel — frontend hosting and analytics.",
              "Cloudflare — bot protection and security (Turnstile).",
              "X (Twitter) — optional social login, giveaway entry verification, and integrations.",
            ]} />
            <P>
              Your use of any third-party service is governed by that service's own terms and privacy policy. We are not responsible for the actions, data practices, or availability of any third-party service. The inclusion of third-party integrations does not constitute an endorsement of those services.
            </P>
          </Section>

          <Section id="ip" title="16. Intellectual Property">
            <P>
              All content, branding, software, and technology comprising the Service — including but not limited to the Loofta name, logo, interface design, and source code — is the exclusive property of Loofta or its licensors and is protected by copyright, trademark, and other intellectual property laws.
            </P>
            <P>
              We grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service solely for its intended purpose. You may not copy, modify, distribute, sell, or otherwise exploit any part of the Service without our express written permission.
            </P>
          </Section>

          <Section id="disclaimer" title="17. Disclaimers">
            <P>
              <strong className="text-white font-medium">No financial advice.</strong> Nothing on the Service constitutes financial, investment, legal, or tax advice. Cryptocurrency values are volatile and you may lose money. You are solely responsible for your own financial decisions.
            </P>
            <P>
              <strong className="text-white font-medium">Assumption of risk for chance-based features.</strong> Participation in Megapot, Mystery Pack, and giveaway features described in Sections 8 through 10 is entirely at your own risk. We make no representation or warranty, express or implied, that you will win any prize, that any drawing will occur on a particular schedule, or that any third-party protocol, sponsor, or data source involved in those features will perform as expected. You assume full responsibility for any financial loss arising from your decision to participate.
            </P>
            <P>
              <strong className="text-white font-medium">As-is basis.</strong> The Service is provided "as is" and "as available" without warranty of any kind, whether express, implied, or statutory. We disclaim all warranties, including implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.
            </P>
            <P>
              We do not warrant that the Service will be uninterrupted, error-free, secure, or that defects will be corrected. Blockchain networks are inherently outside our control and we are not responsible for network congestion, forks, outages, or smart contract vulnerabilities.
            </P>
            <P>
              Some jurisdictions do not allow the exclusion of implied warranties, so some of the above may not apply to you.
            </P>
          </Section>

          <Section id="liability" title="18. Limitation of Liability">
            <P>
              To the maximum extent permitted by applicable law, Loofta and its officers, directors, employees, agents, and licensors shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, including loss of profits, data, goodwill, funds, or other intangible losses, arising from or relating to your use of or inability to use the Service.
            </P>
            <P>
              Without limiting the foregoing, and to the maximum extent permitted by applicable law, we shall not be liable for any losses arising from or relating to: (a) your participation in, or failure to win a prize through, Megapot, Mystery Pack, or giveaway features; (b) the acts, omissions, insolvency, or unavailability of any third-party protocol, sponsor, or fiat off-ramp partner referenced in these Terms; or (c) delays, failures, or errors in any third-party service we integrate with but do not control.
            </P>
            <P>
              Our total cumulative liability to you for any claims arising out of or relating to the Service shall not exceed the greater of (a) the total platform fees paid by you to Loofta in the twelve (12) months preceding the claim, or (b) USD $100.
            </P>
            <P>
              These limitations apply regardless of the legal theory on which the claim is based and even if we have been advised of the possibility of such damages. Some jurisdictions do not allow certain limitations of liability, so some of the above may not apply to you.
            </P>
          </Section>

          <Section id="indemnification" title="19. Indemnification">
            <P>
              You agree to defend, indemnify, and hold harmless Loofta and its affiliates, officers, directors, employees, and agents from and against any claims, damages, obligations, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any third-party rights; or (d) any claim that content you submitted caused damage to a third party.
            </P>
            <P>
              <strong className="text-white font-medium">Release.</strong> To the maximum extent permitted by law, you release Loofta Inc. from all claims, demands and damages, known or unknown, arising out of or relating to your use of the Service or any dispute with another user or third party. If you are a California resident, you waive California Civil Code Section 1542, which says: "A general release does not extend to claims that the creditor or releasing party does not know or suspect to exist in his or her favor at the time of executing the release and that, if known by him or her, would have materially affected his or her settlement with the debtor or released party."
            </P>
            <P>
              <strong className="text-white font-medium">No fiduciary duty or registration.</strong> Loofta Inc. is not a bank, broker-dealer, exchange or investment adviser, and is not registered with the U.S. Securities and Exchange Commission. We owe you no fiduciary duties, we do not guarantee best execution, and you are solely responsible for safeguarding your wallet keys and recovery phrases. Blockchain transactions are irreversible.
            </P>
          </Section>

          <Section id="termination" title="20. Termination">
            <P>
              You may stop using the Service at any time. We may suspend or terminate your access to the Service at any time, with or without cause, with or without notice, effective immediately.
            </P>
            <P>
              Upon termination, your right to use the Service ceases immediately. Sections 5, 8, 9, 10, 11, 13, 16, 17, 18, 19, and 21 of these Terms survive termination. Because the Service is non-custodial, termination of your account does not affect your ability to access funds in your own wallet directly on-chain.
            </P>
          </Section>

          <Section id="governing-law" title="21. Governing Law">
            <P>
              These Terms are governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to conflict of law principles. Any dispute arising from these Terms or the Service shall be resolved exclusively in the state or federal courts located in Delaware, and you consent to personal jurisdiction in those courts.
            </P>
            <P>
              <strong className="text-white font-medium">Informal resolution.</strong> Before filing any formal claim, you agree to try to resolve the dispute informally by contacting us at hello@loofta.xyz. We will try to resolve the dispute informally within 30 days.
            </P>
          </Section>

          <Section id="changes" title="22. Changes to These Terms">
            <P>
              We may update these Terms from time to time. When we make material changes, we will update the effective date at the top of this page and, where required by applicable law, notify you through the application or by email. Your continued use of the Service after any such changes constitutes your acceptance of the new Terms.
            </P>
          </Section>

          <Section id="contact" title="23. Contact">
            <P>
              If you have any questions about these Terms, please contact us at:
            </P>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 font-grotesk text-[14px] text-slate-400">
              <p className="text-white font-medium mb-1">Loofta Inc.</p>
              <p>131 Continental Dr, Suite 305</p>
              <p>Newark, DE 19713, USA</p>
              <p className="mt-1">Email: <a href="mailto:hello@loofta.xyz" className="text-[#FF1301] hover:underline">hello@loofta.xyz</a></p>
              <p className="mt-1">Support: <a href="mailto:hello@loofta.xyz" className="text-[#FF1301] hover:underline">hello@loofta.xyz</a></p>
              <p className="mt-1">Website: <a href="https://loofta.xyz" className="text-[#FF1301] hover:underline">loofta.xyz</a></p>
            </div>
          </Section>
        </div>

        {/* footer link */}
        <div className="mt-16 flex items-center justify-between border-t border-white/[0.06] pt-8">
          <Link href="/privacy" className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors">
            Privacy Policy →
          </Link>
          <Link href="/" className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors">
            Back to Loofta
          </Link>
        </div>
      </div>
    </main>
    </>
  );
}
