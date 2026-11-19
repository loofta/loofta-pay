# @loofta/pay-sdk

Pay any human by email, username, or social handle with stablecoin (USDC on Solana) — SDK for
the Loofta Pay Protocol. Published publicly to npm; there are no secrets baked into the package
itself — access control lives entirely at the integrator-key/x402-signer layer, not the package.

## Install

```bash
npm install @loofta/pay-sdk
```

## Two ways to pay, one call

```ts
import { LooftaPayClient } from "@loofta/pay-sdk";

// Integrator API key — your own system is responsible for actually sending the
// USDC to the returned deposit address (see result.depositAddress).
const loofta = new LooftaPayClient({ apiKey: "lft_live_..." });

// OR: an agent with its own Solana signer — no API key, no prior integration at all.
// The SDK drives the full x402 402 -> sign -> settle round trip and only resolves
// once the payment is confirmed funded on-chain.
const loofta = new LooftaPayClient({ signer: agentSecretKeyBytes });

const result = await loofta.payHuman({
  to: { type: "email", value: "alice@example.com" }, // or username/twitter/discord/github/telegram
  amount: 5,
  description: "thanks for the help",
});

console.log(result.claimLink); // hand this to the recipient — they claim it at link.loofta.xyz
```

`result.status` tells you which case you're in: `"FUNDED"` (x402 path — already done) or
`"PENDING_DEPOSIT"` (API-key path — your system still needs to send
`result.requiredAmountBaseUnits` of USDC to `result.depositAddress`).

## Agent-tool wrapper

```ts
import { LooftaPayClient } from "@loofta/pay-sdk";
import { createPayHumanTool } from "@loofta/pay-sdk/agent-tool";

const client = new LooftaPayClient({ signer: agentSecretKeyBytes });
const payHumanTool = createPayHumanTool(client);
// payHumanTool = { name, description, input_schema, handler } — shaped like an Anthropic
// tool-use definition; drop it straight into a tools array, or lift schema/handler out for
// another agent framework (LangChain, OpenAI function-calling, MCP, etc.)
```

## Notes

- Node.js only for now (uses `Buffer`; a browser build is a reasonable follow-up if there's
  demand for signing directly from a browser-extension wallet).
- Only USDC on Solana is supported today — matches the protocol's own v1 scope.
- The x402 path constructs and signs a real Solana transaction using `@solana/web3.js` directly
  rather than `@x402/svm`'s client (which uses the newer `@solana/kit`/web3.js-v2 ecosystem) —
  keeps this package's dependency footprint small and consistent with the rest of Loofta's stack.

## Partner payouts from your company wallet

For platforms with a partner account. Your server drafts a batch of email payouts and sends your admin to
approve and pay it from the company wallet. An API key can never move money: your team approves the batch and
your company wallet's signers sign it. Switch on "Pay in bulk from your platform" under Developers in the
partner portal first (it is off by default).

```ts
const loofta = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

const batch = await loofta.partner.createBatch({
  idempotencyKey: "2026-11-creator-payouts", // the same key never creates a second batch
  label: "November creators",
  rows: [
    { email: "creator@example.com", amount: 120, externalRef: "inv_881" },
    { email: "alex@example.com", amount: 40 },
  ],
});

redirect(batch.approveUrl); // your admin approves and pays it

const status = await loofta.partner.getBatch(batch.batchId); // pending_approval ... executed
```

Rows are email addresses, 1 to 100 per batch, $1 to $10,000 each.

**Schedule it.** Add `scheduledFor: new Date("2026-12-01T09:00:00Z")` (5 minutes to 90 days ahead). Your team still
approves the batch. At that time Loofta creates the payouts and asks your company wallet's signers to fund them. A
schedule never sends money by itself.

**List, cancel, and get told.**

```ts
await loofta.partner.listBatches({ limit: 10 });
await loofta.partner.cancelBatch(batchId); // only before payouts exist

const { secret } = await loofta.partner.setWebhook("https://yourapp.com/loofta-webhook");
// events: batch.created, batch.approved, batch.ready_to_fund, batch.executed, batch.cancelled,
// batch.schedule_failed, payout.funded, payout.claimed, payout.withdrawn (with your fee)
const event = verifyWebhook<BatchWebhookEvent | PayoutWebhookEvent>(rawBody, signatureHeader, secret);
```

## Bulk payouts from your own wallet (bulk, portal, webhooks)

For platforms that pay from a wallet they sign with themselves. Needs an `apiKey`.

```ts
import { LooftaPayClient, verifyWebhook } from "@loofta/pay-sdk";

const loofta = new LooftaPayClient({
  apiKey: process.env.LOOFTA_API_KEY,
  signer: process.env.PAYOUT_WALLET_SECRET, // optional: lets sendBatch sign and send for you
  rpcUrl: process.env.SOLANA_RPC_URL,
});

// Pay up to 100 people in one call. Retrying with the same key never pays twice.
const batch = await loofta.payouts.sendBatch({
  idempotencyKey: "2026-11-creator-payouts",
  rows: [
    { amount: 120, to: { type: "email", value: "creator@example.com" }, externalRef: "inv_881" },
    { amount: 40, to: { type: "email", value: "alex@example.com" } },
  ],
});

// No signer? createBatch returns packed unsigned transactions for your own wallet flow.
// const { transactions } = await loofta.payouts.createBatch({ ..., senderWallet });

// Your users see their payouts in your app, and withdraw on your branded Loofta page:
const { token } = await loofta.portal.createToken({ externalUserId: "user_123" }); // for @loofta/portal components

// Know when someone is paid:
const { secret } = await loofta.webhooks.set("https://app.example.com/hooks/loofta");
// In your handler, with the RAW body:
const event = verifyWebhook(rawBody, req.headers["x-loofta-signature"], secret); // event.event === "payout.claimed"
```

Recipients withdraw at `pay.loofta.xyz/withdraw?orgId=<your org id>` (your logo, your fees shown up front). They log in as the email or handle you paid.
