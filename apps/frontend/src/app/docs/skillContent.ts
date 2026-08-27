export const LOOFTA_PAYMENT_LINKS_SKILL = `---
name: loofta-payment-links
description: Integrate Loofta Pay payment links into an app so it can receive payments. Use when the user asks to "accept payments", "add a pay button", "get paid", "create a checkout link", "integrate Loofta", or "receive payments" — for a web app, backend, or bot that needs to charge a human and receive USD.
---

# Loofta Payment Links

Create a checkout link that pays a specific Loofta account. The payer needs no Loofta account at
all — checkout defaults to a guest flow (email + any token on any chain, or USDC on Solana from a
connected wallet). If they do have an account, they can sign in on the same page and pay from
their balance instead. Either way the recipient always receives the exact amount — fees are on
the payer.

Keys are **live (mainnet)** — there is no sandbox/test mode yet. Payments made through them move
real money; test with small real amounts.

## 1. Get an API key

The user must generate one themselves at https://pay.loofta.xyz/docs?p=api-key (log in first) —
an agent cannot mint this on their behalf. Ask them to paste the raw key (starts with \`lft_live_\`)
and store it as an environment variable, e.g. \`LOOFTA_API_KEY\`. Never hardcode it or expose it to
a browser — it must only be used server-side.

At most one active key at a time — generating a new one revokes whatever key existed before it.

## 2. Create a payment link (server-side, one per order)

One link is one transaction — it can't be paid twice. Generate a fresh link right when the buyer
clicks "Buy now" (server-side, from your own backend); never create one link once and reuse the
same URL across multiple purchases, or every buyer lands on the same payment record.

\`\`\`bash
curl -X POST https://api.loofta.xyz/payment-links \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "message": "Invoice #1042",
    "webhook_url": "https://your-server.com/webhooks/loofta",
    "return_url": "https://your-store.com/order-confirmed"
  }'
\`\`\`

Response:

\`\`\`json
{
  "short_id": "aB3xK9pQ",
  "url": "https://pay.loofta.xyz/checkout/aB3xK9pQ",
  "amount": 25,
  "message": "Invoice #1042",
  "webhook_secret": "a1b2c3..."
}
\`\`\`

Fields:

- \`amount\` (required): USD, number, $10,000 maximum. $1 minimum for a plain public transfer (the
  default), $5 minimum if \`is_private\` is \`true\`.
- \`message\` (optional): shown to the payer, 1000 chars max.
- \`is_private\` (optional): defaults to \`false\` (a plain public transfer, no privacy fee). Pass
  \`true\` to require the payer to pay privately instead — shields the amount and that it went to
  your wallet on-chain, $5 minimum.
- \`webhook_url\` (optional): POSTed \`{ event: "payment.succeeded", short_id, amount, message, paid_at }\`
  the moment the payer's leg lands, signed with header \`X-Loofta-Signature: sha256=<hmac>\` —
  verify by recomputing \`HMAC-SHA256(rawBody, webhook_secret)\`. \`webhook_secret\` is only in the
  create response, shown once — store it, it can't be fetched again.
- \`return_url\` (optional): where the checkout page sends the buyer once paid. Baked directly into
  the returned \`url\` as \`?callback=...\`, so it works no matter how the link is opened — a plain
  link, a QR code, or a button — not just through a JS component with a live window handle. The
  checkout page appends \`?payment=success&short_id=...\` and navigates there once settled.
- \`url\`: a minimal, unbranded checkout page — safe to link to directly or open in a popup/iframe.
  No Loofta navigation chrome.

## 2b. Finding out when it's paid — poll or webhook, pick one

Save \`short_id\` from the create response against your own order record right when you get it, in
step 2 — that response is the only moment you'll ever see it. Use that saved value below.

Poll (no public endpoint needed on your side):

\`\`\`bash
curl https://api.loofta.xyz/payment-links/aB3xK9pQ -H "Authorization: Bearer $LOOFTA_API_KEY"
# -> { "short_id": "...", "status": "OPEN" | "PRIVATE_TRANSFER_PENDING" | "SUCCESS" | ...,
#      "paid": true | false, "amount": 25, "paid_at": null | "..." }
\`\`\`

**Check \`paid\`, not \`status\`.** \`status\` is Loofta's own internal state — it goes through
\`PRIVATE_TRANSFER_PENDING\` once the customer's payment lands, before eventually reaching
\`SUCCESS\` once the recipient (the API key owner, in their own Loofta account) claims/sweeps the
funds into their wallet — a separate, later step that has nothing to do with whether the order
should be treated as paid. \`paid\` is \`true\` for both, and is what \`webhook_url\` also fires on.

Only ever returns links owned by this API key — someone else's short_id 404s, it doesn't leak.
Otherwise use \`webhook_url\` from step 2 if you'd rather be pushed to than poll.

## 3. TypeScript / JavaScript

\`\`\`bash
npm install @loofta/pay-sdk
\`\`\`

\`\`\`ts
import { LooftaPayClient } from "@loofta/pay-sdk";

const client = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY! });

const link = await client.createPaymentLink({
  amount: 25,
  message: "Invoice #1042",
  returnUrl: "https://your-store.com/order-confirmed",
});
// link.url -> hand this to the user, redirect them to it, or open it in a popup

const status = await client.getPaymentLinkStatus(link.shortId);
// status.paid -> true | false — this is the field to check, not status.status
\`\`\`

## 4. Embedding a button (optional)

\`@loofta/pay-sdk\` is server-side only (it never exposes your API key to the browser), so it
doesn't ship a React component. Copy \`components/sdk/PayButton.tsx\` from the Loofta repo into
your project, or write your own equivalent — the important part is generating a fresh link
server-side on every click, not embedding one static URL:

\`\`\`tsx
<PayButton
  onGenerateLink={async () => {
    const res = await fetch("/api/create-checkout", { method: "POST" }); // your backend, calls createPaymentLink
    const { url } = await res.json();
    return url;
  }}
  buttonText="Buy now"
  onSuccess={(paymentId) => console.log("Paid:", paymentId)}
/>
\`\`\`

A plain link/button pointing at a server-generated \`link.url\` also works fine if you don't need
a full component:

\`\`\`tsx
<a href={link.url} target="_blank" rel="noopener noreferrer">
  Pay \${'$'}{link.amount}
</a>
\`\`\`

See https://pay.loofta.xyz/docs?p=try-it for this pattern wired up end to end.

## Constraints to respect

- One payment link = one fixed amount, one transaction. There is no "open amount" / pay-what-you-want
  link, and a link cannot be reused across multiple orders.
- Links are public (not private) by default. \`is_private: true\` requires the payer to pay
  privately and adds a fee to their total — you still net exactly \`amount\` either way. Don't
  assume privacy or add your own fee expecting to net more.
- The send-payments API (pushing money out programmatically) does not exist yet — only receiving.
- No sandbox/test mode — every key is live. Don't build a "test mode" flag expecting one to exist.
- Full reference: https://pay.loofta.xyz/docs
`;
