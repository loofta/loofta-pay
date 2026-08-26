export const LOOFTA_PAYMENT_LINKS_SKILL = `---
name: loofta-payment-links
description: Integrate Loofta Pay payment links into an app so it can receive payments. Use when the user asks to "accept payments", "add a pay button", "get paid", "create a checkout link", "integrate Loofta", or "receive payments" — for a web app, backend, or bot that needs to charge a human and receive USD.
---

# Loofta Payment Links

Create a checkout link that pays a specific Loofta account. The payer logs in, pays with their
Loofta balance or any funding method (card, bank, Coinbase, any token), and the recipient always
receives the exact amount — fees are on the payer.

## 1. Get an API key

The user must generate one themselves at https://pay.loofta.xyz/app/developer (log in first) —
an agent cannot mint this on their behalf. Ask them to paste the raw key (starts with \`lft_test_\`
or \`lft_live_\`) and store it as an environment variable, e.g. \`LOOFTA_API_KEY\`. Never hardcode it
or expose it to a browser — it must only be used server-side.

## 2. Create a payment link (server-side)

\`\`\`bash
curl -X POST https://api.loofta.xyz/payment-links \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 25, "message": "Invoice #1042", "webhook_url": "https://your-server.com/webhooks/loofta"}'
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

- \`amount\`: USD, number, $10,000 maximum. $5 minimum if private (the default), $1 minimum if public.
- \`message\`: optional, shown to the payer, 1000 chars max.
- \`is_private\`: optional boolean, defaults to \`true\`. Private shields the amount and that it went
  to your wallet on-chain. Pass \`false\` for a plain public transfer instead.
- \`webhook_url\`: optional. POSTed \`{ event: "payment.succeeded", short_id, amount, message, paid_at }\`
  once the payment is fully settled, signed with header \`X-Loofta-Signature: sha256=<hmac>\` —
  verify by recomputing \`HMAC-SHA256(rawBody, webhook_secret)\`. \`webhook_secret\` is only in the
  create response, shown once — store it, it can't be fetched again.
- \`url\`: a minimal, unbranded checkout page — safe to link to directly or open in a popup/iframe.
  No Loofta navigation chrome.

## 2b. Finding out when it's paid — poll or webhook, pick one

Poll (no public endpoint needed on your side):

\`\`\`bash
curl https://api.loofta.xyz/payment-links/aB3xK9pQ -H "Authorization: Bearer $LOOFTA_API_KEY"
# -> { "short_id": "...", "status": "OPEN" | "SUCCESS" | ..., "amount": 25, "paid_at": null | "..." }
\`\`\`

Only ever returns links owned by this API key — someone else's short_id 404s, it doesn't leak.
Otherwise use \`webhook_url\` from step 2 if you'd rather be pushed to than poll.

## 3. TypeScript / JavaScript

\`\`\`bash
npm install @loofta/pay-sdk
\`\`\`

\`\`\`ts
import { LooftaPayClient } from "@loofta/pay-sdk";

const client = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY! });

const link = await client.createPaymentLink({ amount: 25, message: "Invoice #1042" });
// link.url -> hand this to the user, redirect them to it, or open it in a popup

const status = await client.getPaymentLinkStatus(link.shortId);
// status.status -> "OPEN" | "SUCCESS" | ...
\`\`\`

## 4. Embedding a button (optional)

Create the link server-side first (step 2/3), then render a plain link/button pointing at
\`link.url\` — the key itself must never reach the browser. A ready-made React component exists at
\`components/sdk/PayButton.tsx\` in the Loofta repo, or just:

\`\`\`tsx
<a href={link.url} target="_blank" rel="noopener noreferrer">
  Pay \${'$'}{link.amount}
</a>
\`\`\`

## Constraints to respect

- One payment link = one fixed amount. There is no "open amount" / pay-what-you-want link yet.
- Links are private by default (the payer's total already includes the privacy fee) — do not add
  your own fee on top expecting the recipient to net more than \`amount\`. Pass \`is_private: false\`
  for a plain public transfer instead, with no privacy fee.
- The send-payments API (pushing money out programmatically) does not exist yet — only receiving.
- Full reference: https://pay.loofta.xyz/docs
`;
