import type { Metadata } from "next";
import Link from "next/link";
import { MinimalHeader } from "@/components/layout/MinimalHeader";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Loofta Pay Privacy Policy — how we collect, use, and protect your information.",
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

function UL({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-4">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-[8px] h-1 w-1 flex-shrink-0 rounded-full bg-slate-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="p-4 text-left font-medium text-white">Third Party</th>
            <th className="p-4 text-left font-medium text-white">Purpose</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([party, purpose]) => (
            <tr key={party} className="border-b border-white/[0.04] last:border-0">
              <td className="p-4 font-medium text-slate-300 whitespace-nowrap">{party}</td>
              <td className="p-4 text-slate-400">{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOC = [
  { id: "overview", label: "1. Overview" },
  { id: "information-collected", label: "2. Information We Collect" },
  { id: "how-we-use", label: "3. How We Use Your Information" },
  { id: "third-parties", label: "4. Third-Party Services" },
  { id: "chance-features", label: "5. Lottery, Mystery Pack & Giveaway Data" },
  { id: "fiat-offramp-data", label: "6. Fiat Off-Ramp Data (Naira)" },
  { id: "blockchain", label: "7. Blockchain & Public Data" },
  { id: "sharing", label: "8. Information Sharing" },
  { id: "retention", label: "9. Data Retention" },
  { id: "security", label: "10. Security" },
  { id: "cookies", label: "11. Cookies & Local Storage" },
  { id: "gdpr", label: "12. Your Rights (GDPR)" },
  { id: "ccpa", label: "13. Your Rights (CCPA / California)" },
  { id: "children", label: "14. Children's Privacy" },
  { id: "international", label: "15. International Transfers" },
  { id: "changes", label: "16. Changes to This Policy" },
  { id: "contact", label: "17. Contact" },
];

export default function PrivacyPage() {
  return (
    <>
      <MinimalHeader />
    <main className="min-h-screen bg-[#0a0a0c] px-6 py-16 text-white antialiased md:px-10">
      <div className="mx-auto max-w-[760px]">
        {/* header */}
        <div className="mb-12">
          <p className="mb-3 font-grotesk text-sm uppercase tracking-widest text-[#FF1301]">Legal</p>
          <h1 className="mb-4 font-display text-[clamp(2rem,5vw,3.2rem)] font-medium leading-[1.08] tracking-[-0.03em] text-white">
            Privacy Policy
          </h1>
          <p className="font-grotesk text-[14px] text-slate-500">
            Effective date: {EFFECTIVE_DATE} &nbsp;·&nbsp; Last updated: {EFFECTIVE_DATE}
          </p>
        </div>

        {/* intro callout */}
        <div className="mb-12 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <p className="font-grotesk text-base leading-[1.75] text-slate-400">
Loofta Inc., a Delaware corporation with a registered address at 131 Continental Dr, Suite 305, Newark, DE 19713, USA ("we," "us," "our"), respects your privacy. This Privacy Policy explains what information we collect when you use Loofta Pay, how we use it, and your rights regarding that information. We are a non-custodial service — we never hold your funds — and we aim to collect only the minimum data necessary to operate the Service.
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
          <Section id="overview" title="1. Overview">
            <P>
              Loofta Pay is a non-custodial Solana-based payment platform. Authentication is handled by Privy, Inc.; transaction data and user profiles are stored in our own database (Supabase); and certain features rely on third-party services described in Section 4. This policy applies to the Loofta Pay web application and all associated services.
            </P>
          </Section>

          <Section id="information-collected" title="2. Information We Collect">
            <P><strong className="text-white font-medium">a) Information you provide directly</strong></P>
            <UL items={[
              "Email address — when you sign up or log in using email-based authentication via Privy.",
              "X (Twitter) account details — if you choose to log in using your X account via Privy (username and profile identifier).",
              "Username — if you set a custom Loofta username in settings.",
              "Wallet addresses — Solana wallet addresses associated with your account, including addresses of embedded wallets created by Privy on your behalf.",
            ]} />

            <P><strong className="text-white font-medium">b) Information generated by your use of the Service</strong></P>
            <UL items={[
              "Transaction records — sender/recipient identifiers, amount, timestamp, transaction hash, and status for all payments you send or receive through the Service.",
              "Payment links — metadata associated with payment links you create, including any message or emoji attached.",
              "Deposit and withdrawal records — including third-party protocol identifiers and transaction hashes.",
              "Lottery, Mystery Pack, and giveaway activity — ticket purchase records, purchase amount, associated wallet address, giveaway entries you submit or create, and draw or winner results. See Section 5 for details.",
              "Fiat off-ramp activity — if you use the Naira withdrawal feature, we record the withdrawal amount, wallet address used, and transaction status. See Section 6 for details.",
              "Rewards and referral activity.",
            ]} />

            <P><strong className="text-white font-medium">c) Technical information collected automatically</strong></P>
            <UL items={[
              "Browser and device type, operating system, and language preference.",
              "IP address and approximate geographic location (country/region level).",
              "Pages visited, features used, and interaction events — collected via Vercel Analytics in an aggregated, privacy-preserving manner.",
              "Cloudflare Turnstile signals — behavioral signals used to distinguish human users from bots. No personal data is sold or shared from this process.",
            ]} />

            <P><strong className="text-white font-medium">d) Information from third parties</strong></P>
            <UL items={[
              "Privy user identifier — a unique identifier assigned by Privy that we use to link your identity to your Loofta account.",
              "Compliance signals — wallet address risk signals from Range Protocol used to screen withdrawal addresses.",
              "X (Twitter) engagement data — for giveaways tied to a linked X post, we retrieve public engagement data (e.g., quote-tweet author identifiers) from the X API to verify entry eligibility. This data is cached for a short period (up to 60 seconds) to limit repeated API calls.",
              "Fiat off-ramp verification signals — if you use the Naira withdrawal feature, our third-party partner PAJ Cash may independently verify your identity and share limited status information (e.g., verification or transaction status) back to us.",
            ]} />
          </Section>

          <Section id="how-we-use" title="3. How We Use Your Information">
            <P>We use the information we collect to:</P>
            <UL items={[
              "Create and manage your Loofta account.",
              "Authenticate you via Privy when you log in.",
              "Process, record, and display payment transactions you initiate or receive.",
              "Enable you to find other users by email or username to send payments.",
              "Process lottery, Mystery Pack, and giveaway participation, including verifying giveaway entries and recording draw results.",
              "Facilitate fiat off-ramp transactions by sharing necessary wallet and transaction details with our third-party partner.",
              "Screen wallet addresses against sanctions lists and risk databases as required by law.",
              "Provide customer support and respond to your inquiries.",
              "Detect and prevent fraud, abuse, and unauthorized use of the Service.",
              "Send transactional notifications related to your account or payments (we do not send marketing emails without your consent).",
              "Analyze aggregated, anonymized usage patterns to improve the Service.",
              "Comply with applicable legal obligations.",
            ]} />
          </Section>

          <Section id="third-parties" title="4. Third-Party Services">
            <P>
              We share limited data with the following third-party service providers, strictly to the extent necessary to operate the Service:
            </P>
            <Table rows={[
              ["Privy, Inc.", "Identity management and embedded Solana wallet creation. Privy stores your email or social login credentials and manages your embedded wallet keys. See Privy's Privacy Policy at privy.io."],
              ["Supabase", "Database storage for user profiles, payment history, and app state. Data is stored in a managed PostgreSQL instance."],
              ["Vercel", "Frontend hosting (pay.loofta.xyz) and privacy-preserving usage analytics. Vercel Analytics does not use cookies or fingerprinting."],
              ["Railway", "Backend hosting and server-side processing."],
              ["Helius", "Solana RPC infrastructure. Transaction data is broadcast to the Solana network via Helius."],
              ["Range Protocol", "Wallet address compliance and sanctions screening for withdrawals."],
              ["Defuse Protocol / Near Intents", "Cross-chain deposit and withdrawal routing. Your wallet address and intended transaction are shared to facilitate cross-chain operations."],
              ["MagicBlock", "Ephemeral rollup infrastructure used to process private and accelerated on-chain transactions."],
              ["PAJ Cash", "Third-party fiat off-ramp partner. Processes Naira withdrawals and independently collects identity verification (KYC) and bank account information directly from you."],
              ["Cloudflare", "Bot and spam protection (Turnstile). Cloudflare may process IP address and behavioral signals."],
              ["X (Twitter)", "Optional social login and giveaway entry verification. If you log in with X, or enter an X-linked giveaway, Privy or our giveaway feature processes your public X account identifier and engagement data."],
            ]} />
            <P>
              We do not sell your personal information to any third party. We do not share your data with advertisers. We may disclose information to law enforcement or regulators if required by applicable law, court order, or to protect the safety of users or the public.
            </P>
          </Section>

          <Section id="chance-features" title="5. Lottery, Mystery Pack & Giveaway Data">
            <P>
              When you purchase lottery tickets, purchase a Mystery Pack, or create or enter a giveaway, we collect and store records of that activity, including the wallet address used, amount paid, ticket count, entry timestamp, and (where applicable) draw or winner results. This data is used to operate the feature, display your activity history to you, and detect abuse.
            </P>
            <P>
              For giveaways tied to a linked X (Twitter) post, we process public X data (such as the identifier of an account that quote-tweets the linked post) solely to verify entry eligibility, as described in Section 2(d). We do not access private X account data, and we do not use this data for advertising.
            </P>
            <P>
              Because lottery, Mystery Pack, and giveaway transactions are recorded on the Solana blockchain, the wallet-level activity associated with these features is subject to the public-ledger considerations described in Section 7.
            </P>
          </Section>

          <Section id="fiat-offramp-data" title="6. Fiat Off-Ramp Data (Naira)">
            <P>
              If you use the Naira fiat off-ramp feature, we share your wallet address and the relevant transaction details (amount, timestamp, status) with our third-party partner, PAJ Cash, to facilitate the conversion and bank transfer.
            </P>
            <P>
              PAJ Cash independently collects and processes additional information directly from you to complete the off-ramp, including bank account details and identity verification (KYC) documentation. That information is collected and controlled by PAJ Cash under its own privacy policy, not by Loofta. We do not store your bank account number or KYC documents ourselves; we retain only the wallet address, amount, and status of the associated transaction.
            </P>
          </Section>

          <Section id="blockchain" title="7. Blockchain & Public Data">
            <P>
              All transactions processed through the Service are recorded on the Solana blockchain, which is a public, immutable ledger. This means:
            </P>
            <UL items={[
              "Transaction details including wallet addresses, amounts, and timestamps are permanently and publicly visible to anyone who queries the Solana blockchain.",
              "We cannot delete, modify, or obscure blockchain records.",
              "Payment links contain a short identifier that may be shared publicly; the link itself reveals only the payee's identifier and requested amount, not their full wallet address unless the payer views the chain.",
            ]} />
            <P>
              You should be aware of the public nature of blockchain transactions before using the Service. Our non-custodial architecture means your wallet address is the primary identifier for your funds on-chain.
            </P>
          </Section>

          <Section id="sharing" title="8. Information Sharing">
            <P>We may share your information in the following circumstances:</P>
            <UL items={[
              "With service providers listed in Section 4 as necessary to operate the Service.",
              "With other users to the minimum extent required to complete a transaction (e.g., a payer can see that their payment was sent to your username or wallet address).",
              "In connection with a merger, acquisition, or sale of all or a portion of our assets — in which case your information would be subject to the acquirer's privacy policy.",
              "If required by law, regulation, legal process, or governmental request.",
              "To protect the rights, property, or safety of Loofta, our users, or the public.",
            ]} />
          </Section>

          <Section id="retention" title="9. Data Retention">
            <P>
              We retain your account information and transaction history for as long as your account is active, plus a reasonable period thereafter to comply with legal obligations, resolve disputes, and enforce our agreements.
            </P>
            <P>
              If you request deletion of your account, we will delete or anonymize your personal information within 30 days, subject to our obligation to retain certain records under applicable law (e.g., AML regulations may require us to retain transaction, lottery, giveaway, and fiat off-ramp records for up to 5 years).
            </P>
            <P>
              Blockchain transaction data is permanent and cannot be deleted, as described in Section 7.
            </P>
          </Section>

          <Section id="security" title="10. Security">
            <P>
              We implement industry-standard technical and organizational security measures to protect your information, including:
            </P>
            <UL items={[
              "Encryption of sensitive keys at rest using Google Cloud KMS (Key Management Service).",
              "HTTPS encryption for all data in transit.",
              "Access controls limiting internal access to personal data.",
              "Supabase row-level security policies to ensure users can only access their own data.",
              "Cloudflare Turnstile to prevent bot abuse and unauthorized automated access.",
            ]} />
            <P>
              No security system is impenetrable. We cannot guarantee the security of your information, and you use the Service at your own risk. You are responsible for securing your own wallet credentials and login methods.
            </P>
          </Section>

          <Section id="cookies" title="11. Cookies & Local Storage">
            <P>
              The Service uses minimal cookies and browser storage:
            </P>
            <UL items={[
              "Essential session cookies — set by Privy to maintain your authenticated session. These are strictly necessary and cannot be disabled without breaking login functionality.",
              "Local storage — the application may store non-sensitive state (e.g., UI preferences, wallet connection state) in your browser's local storage.",
              "Cloudflare Turnstile — may set a cookie to remember a successful bot challenge.",
            ]} />
            <P>
              We do not use advertising cookies, tracking pixels, or third-party analytics cookies. Vercel Analytics is cookieless.
            </P>
          </Section>

          <Section id="gdpr" title="12. Your Rights (GDPR)">
            <P>
              If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, you have the following rights under the General Data Protection Regulation (GDPR) or equivalent laws:
            </P>
            <UL items={[
              "Right of access — request a copy of the personal data we hold about you.",
              "Right to rectification — request correction of inaccurate or incomplete data.",
              "Right to erasure — request deletion of your personal data, subject to legal retention obligations.",
              "Right to restriction — request that we restrict processing of your data in certain circumstances.",
              "Right to data portability — receive your data in a structured, machine-readable format.",
              "Right to object — object to processing based on legitimate interests.",
              "Right to withdraw consent — where processing is based on your consent, withdraw it at any time.",
            ]} />
            <P>
              To exercise any of these rights, email us at <strong className="text-white">privacy@loofta.xyz</strong> or <strong className="text-white">contact@loofta.xyz</strong>. We will respond within 30 days. You also have the right to lodge a complaint with your local data protection authority.
            </P>
            <P>
              Our legal bases for processing include: performance of a contract (operating the Service for you), compliance with legal obligations, and our legitimate interests in fraud prevention and service improvement.
            </P>
          </Section>

          <Section id="ccpa" title="13. Your Rights (CCPA / California)">
            <P>
              If you are a California resident, the California Consumer Privacy Act (CCPA) provides you with additional rights:
            </P>
            <UL items={[
              "Right to know — request disclosure of the categories and specific pieces of personal information we have collected about you.",
              "Right to delete — request deletion of your personal information, subject to certain exceptions.",
              "Right to opt out of sale — we do not sell your personal information.",
              "Right to non-discrimination — we will not discriminate against you for exercising your privacy rights.",
            ]} />
            <P>
              To make a CCPA request, contact us at contact@loofta.xyz. We will verify your identity before processing the request.
            </P>
          </Section>

          <Section id="children" title="14. Children's Privacy">
            <P>
              The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If you believe we have inadvertently collected information from a child under 18, please contact us immediately at contact@loofta.xyz and we will delete such information promptly.
            </P>
          </Section>

          <Section id="international" title="15. International Data Transfers">
            <P>
              Loofta operates globally and your information may be transferred to, stored in, and processed in the United States and other countries where our service providers maintain infrastructure. By using the Service, you consent to such transfers.
            </P>
            <P>
              Where we transfer personal data from the EEA or UK to countries not deemed to provide an adequate level of data protection, we rely on appropriate transfer mechanisms such as Standard Contractual Clauses (SCCs) or the UK International Data Transfer Addendum.
            </P>
          </Section>

          <Section id="changes" title="16. Changes to This Policy">
            <P>
              We may update this Privacy Policy from time to time. When we make material changes, we will update the effective date and, where required, notify you through the application or by email. We encourage you to review this policy periodically.
            </P>
          </Section>

          <Section id="contact" title="17. Contact">
            <P>
              If you have questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us:
            </P>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 font-grotesk text-[14px] text-slate-400">
              <p className="text-white font-medium mb-1">Loofta Inc. — Privacy</p>
              <p>131 Continental Dr, Suite 305</p>
              <p>Newark, DE 19713, USA</p>
              <p className="mt-1">Email: <a href="mailto:privacy@loofta.xyz" className="text-[#FF1301] hover:underline">privacy@loofta.xyz</a></p>
              <p>General: <a href="mailto:contact@loofta.xyz" className="text-[#FF1301] hover:underline">contact@loofta.xyz</a></p>
              <p className="mt-1">Website: <a href="https://loofta.xyz" className="text-[#FF1301] hover:underline">loofta.xyz</a></p>
            </div>
          </Section>
        </div>

        {/* footer link */}
        <div className="mt-16 flex items-center justify-between border-t border-white/[0.06] pt-8">
          <Link href="/terms" className="font-grotesk text-sm text-slate-500 hover:text-white transition-colors">
            ← Terms of Service
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
