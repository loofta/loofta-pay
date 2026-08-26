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
  -H "Authorization: Bearer lft_test_..." \\
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
            <td className="py-2 text-slate-400">USD, $10,000 maximum. $5 minimum if private (the default), $1 minimum if public.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>message</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Shown to the payer on the checkout page. 1000 characters max.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>is_private</code></td>
            <td className="py-2 pr-4 text-slate-400">boolean, optional</td>
            <td className="py-2 text-slate-400">Defaults to <code>true</code>. Private shields the amount and that it went to your wallet; pass <code>false</code> for a plain public transfer.</td>
          </tr>
          <tr>
            <td className="py-2 pr-4"><code>webhook_url</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">POSTed a signed "payment.succeeded" event once this link is paid — see below.</td>
          </tr>
        </tbody>
      </table>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Response</h2>
      <DocsCodeBlock
        code={`{
  "short_id": "aB3xK9pQ",
  "url": "https://pay.loofta.xyz/checkout/aB3xK9pQ",
  "amount": 25,
  "message": "Invoice #1042",
  "webhook_secret": "a1b2c3..." // only present if you passed webhook_url — shown once
}`}
      />

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Who pays the fees</h2>
      <p className="text-base text-slate-400 mb-6">
        The payer does. You always receive exactly <code>amount</code> — any fee is added on top
        of what they pay, never deducted from what you get. A private link's fee is 10 bps plus
        ~$0.20 flat gas; a public link has no privacy fee.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Knowing when it's paid</h2>
      <p className="text-base text-slate-400 mb-3">
        One link is one transaction — it can't be paid twice, so create a new link per order/customer
        rather than reusing one link for everyone. Two ways to find out it's done, pick whichever
        fits — you don't need both.
      </p>

      <p className="text-base text-slate-300 font-medium mb-2">Option A — poll</p>
      <p className="text-base text-slate-400 mb-3">
        No public endpoint needed on your side. Check whenever it's convenient — right after
        redirect, on a timer, whatever fits your flow:
      </p>
      <DocsCodeBlock
        label="GET /payment-links/{short_id}"
        code={`curl https://api.loofta.xyz/payment-links/aB3xK9pQ \\
  -H "Authorization: Bearer lft_test_..."

{
  "short_id": "aB3xK9pQ",
  "status": "SUCCESS",
  "amount": 25,
  "message": "Invoice #1042",
  "paid_at": "2026-08-24T12:00:00.000Z"
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        Only ever returns your own links — a <code>short_id</code> that isn't yours 404s.{" "}
        <code>status</code> is <code>OPEN</code> until paid, then <code>SUCCESS</code>.
      </p>

      <p className="text-base text-slate-300 font-medium mb-2">Option B — webhook</p>
      <p className="text-base text-slate-400 mb-3">
        Pushed to you the moment it happens, no polling loop to run — better if you're fulfilling
        orders unattended. If you passed <code>webhook_url</code>, Loofta POSTs a signed event
        there the moment the payment is fully settled to your wallet:
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
