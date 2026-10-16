import { DocsCodeBlock } from "../DocsCodeBlock";

export function ReceivePayments({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Create a payment link</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        <code className="text-orange-300">POST /payment-links</code> creates a checkout link that
        pays you — the owner of the API key. Pass an amount and an optional message; get back a
        URL to share.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Request</h2>
      <DocsCodeBlock
        label="POST /payment-links"
        code={`curl -X POST https://api.loofta.xyz/payment-links \\
  -H "Authorization: Bearer lft_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "message": "Invoice #1042"
  }'`}
      />

      <table className="w-full text-base text-left mb-6">
        <thead>
          <tr className="text-base text-slate-400 border-b border-white/10">
            <th className="py-2 pr-4 font-medium">Field</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="text-slate-300">
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>amount</code></td>
            <td className="py-2 pr-4 text-slate-400">number</td>
            <td className="py-2 text-slate-400">USD, $10,000 maximum. $0.01 minimum for a plain public transfer (the default), $1 minimum if <code>is_private</code> is <code>true</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>message</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Shown to the payer on the checkout page. 1000 characters max.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>is_private</code></td>
            <td className="py-2 pr-4 text-slate-400">boolean, optional</td>
            <td className="py-2 text-slate-400">Defaults to <code>false</code> (plain public transfer). Pass <code>true</code> to require the payer to pay privately — shields the amount and that it went to your wallet on-chain, $1 minimum.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>webhook_url</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">POSTed a signed "payment.succeeded" event once the payer's leg lands — see below.</td>
          </tr>
          <tr>
            <td className="py-2 pr-4"><code>return_url</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Where the checkout page sends the buyer once paid. Baked into the returned <code>url</code> — works no matter how the link was opened (a plain link, QR code, or <code>PayButton</code>).</td>
          </tr>
        </tbody>
      </table>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Response</h2>
      <DocsCodeBlock
        code={`{
  "short_id": "aB3xK9pQ",
  "url": "https://pay.loofta.com/checkout/aB3xK9pQ",
  "amount": 25,
  "message": "Invoice #1042",
  "webhook_secret": "a1b2c3..." // only present if you passed webhook_url — shown once
}`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Who pays the fees</h2>
      <p className="text-base text-slate-400 mb-6">
        The payer does. You always receive exactly <code>amount</code> — any fee is added on top
        of what they pay, never deducted from what you get. A private link's fee is 10 bps plus
        ~$0.20 flat gas; a public link (the default) has no privacy fee at all.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Knowing when it's paid</h2>
      <p className="text-base text-slate-400 mb-3">
        One link is one transaction — it can't be paid twice, so create a new link per order/customer
        rather than reusing one link for everyone. See{" "}
        <code className="text-orange-300">onGenerateLink</code> in the{" "}
        <button type="button" onClick={() => onNavigate("try-it")} className="text-orange-400 hover:underline">demo store</button> for the
        actual pattern: call this endpoint fresh, right when the buyer clicks "Buy now".
      </p>
      <p className="text-base text-slate-400 mb-3">
        Save <code>short_id</code> against your own order record the moment the create response
        comes back, server-side — that's the only point you'll ever see it handed to you, and
        it's what you'll poll or match an incoming webhook against later. Two ways to find out
        it's done, pick whichever fits — you don't need both.
      </p>

      <p className="text-base text-slate-300 font-medium mb-2">Option A — poll</p>
      <p className="text-base text-slate-400 mb-3">
        No public endpoint needed on your side. Check whenever it's convenient — right after
        redirect, on a timer, whatever fits your flow:
      </p>
      <DocsCodeBlock
        label="GET /payment-links/{short_id}"
        code={`curl https://api.loofta.xyz/payment-links/aB3xK9pQ \\
  -H "Authorization: Bearer lft_live_..."

{
  "short_id": "aB3xK9pQ",
  "status": "PRIVATE_TRANSFER_PENDING",
  "paid": true,
  "amount": 25,
  "message": "Invoice #1042",
  "paid_at": "2026-08-24T12:00:00.000Z"
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        Only ever returns your own links — a <code>short_id</code> that isn't yours 404s. Check{" "}
        <code>paid</code>, not <code>status</code>, for "did the customer pay": it's <code>true</code>{" "}
        for both <code>SUCCESS</code> and <code>PRIVATE_TRANSFER_PENDING</code>. The latter just
        means your own claim/sweep of the funds into your wallet is still outstanding — that's a
        separate step you take in the Loofta app, unrelated to whether the order should be
        considered paid.
      </p>

      <p className="text-base text-slate-300 font-medium mb-2">Option B — webhook</p>
      <p className="text-base text-slate-400 mb-3">
        Pushed to you the moment it happens, no polling loop to run — better if you're fulfilling
        orders unattended. If you passed <code>webhook_url</code>, Loofta POSTs a signed event
        there the moment the customer's payment lands (same <code>paid: true</code> moment as
        above — not when you personally get around to claiming it):
      </p>
      <DocsCodeBlock
        code={`POST <your webhook_url>
X-Loofta-Signature: sha256=<hmac>

{
  "event": "payment.succeeded",
  "short_id": "aB3xK9pQ",
  "amount": 25,
  "message": "Invoice #1042",
  "paid_at": "2026-08-24T12:00:00.000Z"
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        Verify it: recompute <code>HMAC-SHA256(rawBody, webhook_secret)</code> and compare against
        the header. If you rendered <code>PayButton</code> in a popup, its <code>onSuccess</code>{" "}
        also fires client-side as soon as the payer's own side of the payment lands — useful for
        instant UI feedback, but option A or B is what to trust for actually fulfilling an order.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Next:{" "}
          <button type="button" onClick={() => onNavigate("checkout-page")} className="text-orange-400 hover:underline">
            what the payer sees
          </button>.
        </p>
      </div>
    </article>
  );
}
