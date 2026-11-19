import { DocsCodeBlock } from "../DocsCodeBlock";

export function PartnerPayouts({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Partner payouts</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Pay your creators, freelancers or contributors in bulk from your own platform. Your server drafts a batch with
        your API key, your team approves it, and the money is paid from your company wallet. Each person gets an email
        with your name and logo and withdraws on a page that carries your branding.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-8">
        <p className="text-slate-300 text-base">
          An API key can never move money. It only drafts a batch. A signed-in owner or admin has to approve it, and your
          company wallet&apos;s signers still have to sign before a single payout leaves.
        </p>
      </div>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">1. Set it up once</h2>
      <ol className="list-decimal pl-5 space-y-2 text-base text-slate-400 mb-4">
        <li>Open the partner portal at <code className="text-orange-300">pay.loofta.com/app/partner</code> and create your organisation.</li>
        <li>Create your company wallet under Wallet and add some USDC to it.</li>
        <li>
          Under Developers, create an API key (it starts with <code className="text-orange-300">lft_live_</code>), then
          turn on <span className="text-slate-200">Pay in bulk from your platform</span>. Only an owner can do this, and
          it is off by default.
        </li>
      </ol>
      <p className="text-base text-slate-400 mb-4">
        Keep the key on your server, in an environment variable such as <code className="text-orange-300">LOOFTA_API_KEY</code>.
        Never ship it to a browser. See{" "}
        <button type="button" onClick={() => onNavigate("authentication")} className="text-orange-400 hover:underline">
          Authentication
        </button>
        .
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">2. Draft a batch</h2>
      <p className="text-base text-slate-400 mb-3">
        Call this when your admin clicks &quot;Pay creators&quot;. Recipients are email addresses, between 1 and 100 per
        batch, and each payout is between $1 and $10,000.
      </p>
      <DocsCodeBlock
        label="npm install @loofta/pay-sdk"
        code={`import { LooftaPayClient } from "@loofta/pay-sdk";

const loofta = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

const batch = await loofta.partner.createBatch({
  idempotencyKey: \`payout-\${cycleId}\`, // the same key never creates a second batch
  label: "November creators",
  rows: creators.map((c) => ({
    email: c.email,
    amount: c.owed, // USD
    externalRef: c.id, // your own id, returned to you as is
    message: "November earnings",
  })),
});

console.log(batch.approveUrl);`}
      />
      <DocsCodeBlock
        label="Or with curl"
        code={`curl -X POST https://api.loofta.xyz/partner-api/batches \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotency_key": "payout-2026-11",
    "label": "November creators",
    "rows": [
      { "recipient_type": "email", "recipient_identifier": "alice@example.com", "amount": 120, "external_ref": "user_42" }
    ]
  }'`}
      />
      <p className="text-base text-slate-400 mb-3">The response includes the batch and the link to send your admin to:</p>
      <DocsCodeBlock
        label="Response"
        code={`{
  "batch_id": "6f1c0a52-...",
  "status": "pending_approval",
  "item_count": 1,
  "total_amount": 120,
  "approve_url": "https://pay.loofta.xyz/app/partner?org=org_...&tab=payouts&batch=6f1c0a52-...",
  "items": [
    { "row_index": 0, "recipient_identifier": "alice@example.com", "amount": 120, "external_ref": "user_42", "status": "queued" }
  ]
}`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">3. Send your admin to approve and pay</h2>
      <p className="text-base text-slate-400 mb-3">
        Redirect the admin to <code className="text-orange-300">approveUrl</code>. They sign in with email, review the
        rows, approve the batch and pay it from the company wallet. If your company wallet needs more than one
        signature, the other signers approve under Wallet. Recipients are emailed once the payout is funded.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">4. Follow its progress</h2>
      <DocsCodeBlock
        code={`const batch = await loofta.partner.getBatch(batchId);
// batch.status: pending_approval, approved, awaiting_funding, executed, cancelled or rejected
// batch.items[i].withdrawn: true once that person has withdrawn it`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Show creators their earnings</h2>
      <p className="text-base text-slate-400 mb-3">
        Your creators see what they were paid inside your own app, with a Withdraw button, using the{" "}
        <code className="text-orange-300">@loofta/portal</code> widget. Mint a short-lived token on your server for the
        signed-in user:
      </p>
      <DocsCodeBlock
        code={`const { token } = await loofta.portal.createToken({ email: user.email });
return Response.json({ token });`}
      />
      <DocsCodeBlock
        label="React"
        code={`import { Payouts } from "@loofta/portal";

<Payouts getToken={() => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token)} />`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Errors</h2>
      <ul className="list-disc pl-5 space-y-2 text-base text-slate-400 mb-6">
        <li><code className="text-orange-300">403</code> The key is not linked to a partner, the partner is suspended, or Pay in bulk is switched off.</li>
        <li><code className="text-orange-300">400</code> A recipient is not an email address, or an amount is outside $1 to $10,000.</li>
        <li><code className="text-orange-300">429</code> Too many requests. Wait a moment and retry with the same idempotency key.</li>
      </ul>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Building with a coding agent? The{" "}
          <button type="button" onClick={() => onNavigate("agent-skill")} className="text-orange-400 hover:underline">
            agent skill
          </button>{" "}
          for partner payouts has all of this in a format it can follow directly.
        </p>
      </div>
    </article>
  );
}
