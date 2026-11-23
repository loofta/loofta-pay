export const LOOFTA_PAYMENT_LINKS_SKILL = `---
name: loofta-payment-links
description: Integrate Loofta Pay into an app so it can receive payments (payment links) and send payments (payouts). Use when the user asks to "accept payments", "add a pay button", "get paid", "create a checkout link", "pay someone out", "send USDC to an email/handle", "integrate Loofta", "receive payments", or "send payments" — for a web app, backend, or bot that needs to charge a human, pay one out, or both.
---

# Loofta Pay

Create a checkout link that pays a specific Loofta account. The payer needs no Loofta account at
all — checkout defaults to a guest flow (email + any token on any chain, or USDC on Solana from a
connected wallet). If they do have an account, they can sign in on the same page and pay from
their balance instead. Either way the recipient always receives the exact amount — fees are on
the payer.

Keys are **live (mainnet)** — there is no sandbox/test mode yet. Payments made through them move
real money; test with small real amounts.

## 1. Get an API key

The user must generate one themselves at https://pay.loofta.com/docs?p=api-key (log in first) —
an agent cannot mint this on their behalf. Ask them to paste the raw key (starts with \`lft_live_\`)
and store it as an environment variable, e.g. \`LOOFTA_API_KEY\`. Never hardcode it or expose it to
a browser — it must only be used server-side.

At most one active key at a time — generating a new one revokes whatever key existed before it.

## 2. Create a payment link (server-side, one per order)

One link is one transaction — it can't be paid twice. Generate a fresh link right when the buyer
clicks "Buy now" (server-side, from your own backend); never create one link once and reuse the
same URL across multiple purchases, or every buyer lands on the same payment record.

\`\`\`bash
curl -X POST https://api.loofta.com/payment-links \\
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
  "url": "https://pay.loofta.com/checkout/aB3xK9pQ",
  "amount": 25,
  "message": "Invoice #1042",
  "webhook_secret": "a1b2c3..."
}
\`\`\`

Fields:

- \`amount\` (required): USD, number, $10,000 maximum. $0.01 minimum for a plain public transfer (the
  default), $1 minimum if \`is_private\` is \`true\`.
- \`message\` (optional): shown to the payer, 1000 chars max.
- \`is_private\` (optional): defaults to \`false\` (a plain public transfer, no privacy fee). Pass
  \`true\` to require the payer to pay privately instead — shields the amount and that it went to
  your wallet on-chain, $1 minimum.
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
curl https://api.loofta.com/payment-links/aB3xK9pQ -H "Authorization: Bearer $LOOFTA_API_KEY"
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

See https://pay.loofta.com/docs?p=try-it for this pattern wired up end to end.

## 5. Send payments (pay someone out)

The reverse of a payment link: \`POST /payouts\` pays a recipient — by email, username, or social
handle — from the API key owner's own account, instead of collecting from someone else.
Self-custody: it returns an **unsigned** transaction, never moves funds itself. Only the caller's
own \`sender_wallet\` can authorize it, by signing that transaction and broadcasting it.

\`\`\`bash
curl -X POST https://api.loofta.com/payouts \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "recipient_type": "email",
    "recipient_identifier": "alice@example.com",
    "sender_wallet": "5dCT...BKuq",
    "message": "August payout"
  }'
\`\`\`

Response:

\`\`\`json
{
  "payment_id": "b3f1...e02a",
  "short_id": "aB3xK9pQ",
  "claim_link": "https://pay.loofta.com/c/aB3xK9pQ",
  "unsigned_transaction": "AQAAAAAAAAAAAAAAAAAAAAAA...",
  "transaction_version": "legacy",
  "send_to": "base",
  "is_private": false
}
\`\`\`

Fields:

- \`amount\` (required): USD, $10,000 maximum, $0.01 minimum ($1 if \`is_private\` is \`true\`).
- \`recipient_type\` (required): \`email\`, \`username\`, \`twitter\`, \`discord\`, \`github\`, or \`telegram\`.
- \`recipient_identifier\` (required): the email/username/handle matching \`recipient_type\`.
- \`sender_wallet\` (required unless \`funding_source\` is set): the caller's own Solana wallet
  public key — pays gas and signs the returned transaction. Loofta never holds this wallet's key.
- \`funding_source\` (optional): pay from another chain instead — \`gram_ton\` (native TON coin) or
  \`usdc_base\`. Pass this instead of \`sender_wallet\`; requires
  \`refund_wallet\`. See below.
- \`refund_wallet\` (required when \`funding_source\` is set): your address on the \`funding_source\`
  chain, used to refund you if the deposit can't complete.
- \`message\` (optional): shown to the recipient on their claim page, 500 chars max.
- \`is_private\` (optional): defaults to \`false\`. \`true\` shields the amount and sender wallet
  on-chain — a MagicBlock private transfer, ~10 bps + $0.20 flat gas on top of \`amount\`. Requires
  \`amount\` to be at least $1.

Sign and broadcast \`unsigned_transaction\` yourself — \`transaction_version\` tells you whether to
deserialize it as a legacy \`Transaction\` or \`VersionedTransaction\`, and \`send_to\` tells you which
RPC to broadcast to (a private transfer can require MagicBlock's \`"ephemeral"\` rollup RPC instead
of \`"base"\` Solana):

\`\`\`ts
import { Connection, Transaction, VersionedTransaction, Keypair } from "@solana/web3.js";

const rpcUrl = send_to === "ephemeral"
  ? "https://mainnet-tee.magicblock.app"
  : "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpcUrl);
const senderKeypair = Keypair.fromSecretKey(/* your own key, never sent to Loofta */);

const raw = Buffer.from(unsigned_transaction, "base64");
const tx = transaction_version === "v0"
  ? VersionedTransaction.deserialize(raw)
  : Transaction.from(raw);

tx.sign(senderKeypair); // VersionedTransaction: tx.sign([senderKeypair])
const signature = await connection.sendRawTransaction(tx.serialize());
\`\`\`

The recipient sees the payout waiting at \`claim_link\` the moment the transaction lands — same
claim/burner mechanics as every other Loofta payment. An unregistered recipient claims by signing
in with the same email/handle it was sent to.

### Funding from another chain

Pass \`funding_source\` instead of \`sender_wallet\` to skip the Solana transaction entirely:

\`\`\`bash
curl -X POST https://api.loofta.com/payouts \\
  -H "Authorization: Bearer $LOOFTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "recipient_type": "email",
    "recipient_identifier": "alice@example.com",
    "funding_source": "gram_ton",
    "refund_wallet": "UQYourTonAddress..."
  }'
\`\`\`

Response:

\`\`\`json
{
  "payment_id": "b3f1...e02a",
  "short_id": "aB3xK9pQ",
  "claim_link": "https://pay.loofta.com/c/aB3xK9pQ",
  "is_private": false,
  "funding_source": "gram_ton",
  "deposit_address": "UQC9f2c...4a1b",
  "deposit_address_raw": "0:bd7f6c...",
  "deposit_memo": null,
  "deposit_amount": "18.652031",
  "deposit_deadline": "2026-09-07T12:34:56.000Z"
}
\`\`\`

Send exactly \`deposit_amount\` of the \`funding_source\` token to \`deposit_address\` (include
\`deposit_memo\` if present) before \`deposit_deadline\`. Alice sees the payout at \`claim_link\` once
the deposit is confirmed and swept — there's nothing to sign or broadcast on this path.

\`gram_ton\` pays with native TON coin (most bridge APIs, including NEAR Intents, label it \`GRAM\` —
TON's original pre-launch name) rather than a USDT jetton — a plain value transfer, so there's no
jetton-wallet notification step that can fail from insufficient gas the way a jetton transfer's
can. It's also fee-free: Loofta never adds its own cross-chain fee on top of this route. NEAR
Intents/HOT's own bridge fee (the gap between \`amount\` and \`deposit_amount\`) still applies —
that's real, unavoidable bridging cost on their side, not something either of us controls.

A payout that's never funded (unsigned_transaction never signed and broadcast, or nothing ever
sent to deposit_address) auto-expires — 4 hours after creation for the \`sender_wallet\` path;
for \`funding_source\`, the deposit address's own bridge-quote deadline instead (often a few days,
never less than 4 hours), so the claim doesn't die before the address stops being watched. After
expiry \`claim_link\` no longer accepts payment. An already-funded payout is unaffected regardless
of how long the recipient takes to claim it.

### Whitelabeling the claim page

By default \`claim_link\` points to a Loofta-branded page at \`pay.loofta.com\`. Putting that page
on your own domain with your own branding (no Loofta name visible to the recipient) is not
self-serve. It's configured on-demand per integrator. Have the user email hello@loofta.xyz with
the domain they want and their expected volume; don't imply this can be turned on via an API call
or dashboard toggle.

## Constraints to respect

- One payment link = one fixed amount, one transaction. There is no "open amount" / pay-what-you-want
  link, and a link cannot be reused across multiple orders.
- Links are public (not private) by default. \`is_private: true\` requires the payer to pay
  privately and adds a fee to their total — you still net exactly \`amount\` either way. Don't
  assume privacy or add your own fee expecting to net more.
- \`POST /payouts\` pays one recipient. To pay many people from a wallet you sign with, use
  \`POST /payouts/batches\` (up to 100 rows). To pay many people from a partner company wallet, use the
  partner payouts skill instead.
- \`/payouts\` never signs or broadcasts anything itself — with \`sender_wallet\`, you must sign
  \`unsigned_transaction\` with that key and submit it; with \`funding_source\`, you must actually
  send the token to \`deposit_address\`. Don't expect funds to move just from calling the endpoint.
- No sandbox/test mode — every key is live. Don't build a "test mode" flag expecting one to exist.
- Full reference: https://pay.loofta.com/docs
`;

export const LOOFTA_PARTNER_PAYOUTS_SKILL = `---
name: loofta-partner-payouts
description: Pay many people from a platform through Loofta partner payouts. Use when the user asks to "pay creators", "pay my users in bulk", "mass payouts", "bulk payouts by email", "add a pay creators button", "show users their earnings", "payout widget", or "integrate Loofta partner payouts" for an app that owes money to many people (creators, freelancers, contributors, affiliates).
---

# Loofta partner payouts

A platform pays many people by email from its own company wallet. Each recipient gets an email under the
platform's name and logo and withdraws on a page that carries the platform's branding. The platform can also
show every user their earnings inside its own app.

An API key can NEVER move money. The platform's server drafts a batch, a signed-in owner or admin approves it
in the Loofta partner portal, and the company wallet's signers sign it. Never promise the user that calling the
API sends money.

## 1. One-time setup (the user does this, an agent cannot)

1. Create an organisation at https://pay.loofta.com/partner/portal and sign in with email.
2. Create the company wallet under Wallet, then add USDC to it.
3. Under Developers, create an API key (starts with \`lft_live_\`) and switch on "Pay in bulk from your
   platform". Only an owner can switch it on. It is off by default.

Ask the user to paste the key and store it as \`LOOFTA_API_KEY\`. Use it only on the server, never in a browser
or a client bundle. Keys are live (mainnet). There is no sandbox, so test with small amounts.

## 2. Draft a batch (server side)

\`\`\`bash
npm install @loofta/pay-sdk
\`\`\`

\`\`\`ts
import { LooftaPayClient } from "@loofta/pay-sdk";

const loofta = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

const batch = await loofta.createBatch({
  idempotencyKey: \`payout-\${cycleId}\`, // reuse the same key on retry, it never creates a second batch
  label: "November creators",
  rows: creators.map((c) => ({ email: c.email, amount: c.owed, externalRef: c.id })),
});
// batch.approveUrl is where the admin approves and pays it
\`\`\`

Raw HTTP: \`POST https://api.loofta.com/partner-api/batches\` with \`Authorization: Bearer $LOOFTA_API_KEY\` and
\`{ idempotency_key, label?, rows: [{ recipient_type: "email", recipient_identifier, amount, external_ref?, message? }] }\`.

Rules to respect:
- Recipients are email addresses only. Twitter, wallets and other handles are rejected.
- 1 to 100 rows per batch. Each amount is $1 to $10,000. Split bigger payouts across batches.
- Use a stable, unique \`idempotencyKey\` per payout cycle (for example the cycle or invoice id), never a random value
  per request, or a retry will draft a second batch.
- The batch always starts as \`pending_approval\`. Do not build a flow that waits for it to pay on its own.

## 3. Send the admin to approve and pay

Redirect (or link) the admin to \`batch.approveUrl\`. That is a "Pay creators" button: the click handler runs
step 2 on the server and then redirects. They approve and pay from the company wallet, and recipients are
emailed once it is funded.

## 4. Follow progress

\`\`\`ts
const b = await loofta.getBatch(batchId);
// b.status: pending_approval | approved | awaiting_funding | executed | cancelled | rejected
// b.items[i].withdrawn is true once that person withdrew
\`\`\`

Poll this from your own admin screen, or use webhooks (below).

## 4b. Schedule a batch (optional)

\`\`\`ts
await loofta.createBatch({ idempotencyKey, rows, scheduledFor: new Date("2026-12-01T09:00:00Z") });
\`\`\`

\`scheduledFor\` is 5 minutes to 90 days ahead. The batch is still approved by a person first. At the time, Loofta
creates the payouts and asks the company wallet's signers to fund them. A schedule NEVER sends money by itself,
so do not tell the user it will pay automatically. If the run fails, \`batch.scheduledError\` says why.

Also: \`loofta.listBatches({ limit })\` and \`loofta.cancelBatch(id)\` (only before payouts exist).

## 4c. Webhooks (optional)

\`\`\`ts
const { secret } = await loofta.setWebhook("https://yourapp.com/loofta-webhook"); // store as LOOFTA_WEBHOOK_SECRET
\`\`\`

Events: batch.created, batch.approved, batch.ready_to_fund, batch.executed, batch.cancelled, batch.schedule_failed,
payout.funded, payout.claimed, payout.withdrawn (carries partner_fee_usdc, net_usdc, tx_hash). Verify each one with
\`verifyWebhook(rawBody, req.headers.get("x-loofta-signature"), secret)\` using the RAW body, and dedupe on the
\`X-Loofta-Event-Id\` header because events can repeat.

## 4d. Withdraw page options (optional)

Every cash-out route and the payout history are ON by default. Only change them if the user asks.

\`\`\`ts
await loofta.setWithdrawOptions({ disabledMethods: ["bank", "p2p"], showHistory: false });
const o = await loofta.getWithdrawOptions(); // o.enabledMethods, o.disabledMethods, o.showHistory
\`\`\`

Methods: \`usdc\` (USDC on Solana), \`token\` (other tokens), \`bank\` (bank or card), \`p2p\` (Wise, PayPal, Revolut...).
At least one must stay on. Send only the fields to change. This never touches fees or where money goes.

## 5. Show users their earnings (optional)

Server, for the signed-in user:

\`\`\`ts
const { token } = await loofta.createPortalToken({ email: user.email });
return Response.json({ token });
\`\`\`

Browser (React):

\`\`\`tsx
import { Payouts } from "@loofta/portal";

<Payouts getToken={() => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token)} />
\`\`\`

The token lasts 15 minutes and is scoped to that one user. Mint it per page load, never store it.

## Errors

- 403: key not linked to a partner, partner suspended, or "Pay in bulk" is switched off.
- 400: a recipient is not an email, or an amount is outside $1 to $10,000.
- 429: rate limited. Retry later with the same idempotency key.

Full reference: https://pay.loofta.com/docs?p=partner-payouts
`;
