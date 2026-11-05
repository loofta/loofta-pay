export type RecipientType = "email" | "username" | "twitter" | "discord" | "github" | "telegram";
/** Bulk payouts can also target your own user id (`partner_user`): they claim in the payout portal with no Loofta account. */
export type PayoutRecipientType = RecipientType | "partner_user";

export interface PayHumanParams {
  to: { type: RecipientType; value: string };
  /** USD amount, e.g. 5 or "5.00". Only USDC is supported today. */
  amount: string | number;
  token?: "USDC";
  description?: string;
}

export interface PayHumanResult {
  paymentId: string;
  shortId: string | null;
  claimLink: string;
  /**
   * 'PENDING_DEPOSIT' when using an API key: the payment record exists, but YOUR system still
   * needs to send `requiredAmountBaseUnits` of USDC to `depositAddress` to actually fund it.
   * 'FUNDED' when using a signer (the x402 path): the SDK built, signed, and settled the
   * payment itself — funding is already complete by the time this resolves.
   */
  status: "PENDING_DEPOSIT" | "FUNDED";
  /** Only present for the API-key path — where your own system must send the deposit. */
  depositAddress?: string;
  requiredAmountBaseUnits?: string;
}

export interface CreatePaymentLinkParams {
  /** USD amount the recipient (the API key owner) should net. $0.01 minimum for a plain public
   *  transfer (the default); $1 minimum if isPrivate is true. */
  amount: number;
  /** Shown to the payer on the checkout page. */
  message?: string;
  /** Defaults to false (a plain public transfer) — the recipient can still choose to claim
   *  privately at claim time regardless. Pass true to require the payer to pay privately instead
   *  (shields the amount and that it went to you on-chain, $1 minimum). */
  isPrivate?: boolean;
  /** POSTed with a signed "payment.succeeded" event once this link is paid — see
   *  CreatePaymentLinkResult.webhookSecret for verifying the signature. */
  webhookUrl?: string;
  /** Where to send the buyer back once paid — baked into the returned checkout URL, so it works
   *  no matter how the link ends up being opened (PayButton, a plain link, a QR code, pasted
   *  directly into a browser). The checkout page appends ?payment=success&short_id=... and
   *  navigates there once the payment settles. */
  returnUrl?: string;
}

export interface CreatePaymentLinkResult {
  shortId: string;
  /** Minimal, unbranded checkout page — no Loofta chrome, just the pay card. */
  url: string;
  amount: number;
  message: string | null;
  /**
   * Only present when webhookUrl was set — shown once, store it yourself. Each webhook POST
   * carries `X-Loofta-Signature: sha256=<hex>`, an HMAC-SHA256 of the raw JSON body keyed by
   * this secret; recompute and compare to verify the callback actually came from Loofta.
   */
  webhookSecret: string | null;
}

export interface PaymentLinkStatus {
  shortId: string;
  /** OPEN | IN_FLIGHT | SUCCESS | PRIVATE_TRANSFER_PENDING | EXPIRED | CANCELLED | ... */
  status: string;
  /**
   * Whether the customer's payment has actually landed — true for both SUCCESS and
   * PRIVATE_TRANSFER_PENDING. Check this, not `status`: PRIVATE_TRANSFER_PENDING means the
   * customer already paid and only the recipient's own claim into their wallet is still
   * outstanding, which has nothing to do with whether the order should be treated as paid.
   */
  paid: boolean;
  amount: number;
  message: string | null;
  paidAt: string | null;
}

export interface LooftaPayClientOptions {
  /** Integrator API key (Bearer token) — the plain-REST path. Your own system funds the deposit
   *  address returned by payHuman(); the SDK doesn't sign or send anything in this mode. */
  apiKey?: string;
  /** A Solana signer — the x402 path. No API key needed: the SDK builds, signs, and submits
   *  (via the resource server's facilitator) a real on-chain payment itself. Accepts a raw
   *  64-byte secret key, a base58-encoded secret key string, or an @solana/web3.js Keypair. */
  signer?: Uint8Array | string | { secretKey: Uint8Array };
  /** Defaults to https://api.loofta.xyz */
  baseUrl?: string;
  /** Solana RPC used by payouts.sendBatch. Defaults to the public mainnet RPC; use your own in production. */
  rpcUrl?: string;
}

export interface PayoutRow {
  /** USD amount the recipient gets. */
  amount: number;
  to: { type: PayoutRecipientType; value: string };
  /** Your own id for this row (invoice, user, referral). Returned in results and webhooks. */
  externalRef?: string;
  message?: string;
}

export interface CreatePayoutBatchParams {
  /** Unique per batch. Retrying with the same key never pays twice. */
  idempotencyKey: string;
  label?: string;
  /** 1 to 100 rows. */
  rows: PayoutRow[];
  isPrivate?: boolean;
}

export interface PayoutBatchItemResult {
  rowIndex: number;
  externalRef: string | null;
  status: "created" | "failed";
  paymentId: string | null;
  claimLink: string | null;
  error: string | null;
  unsignedTransaction: string | null;
}

export interface PayoutBatchResult {
  batchId: string;
  itemCount: number;
  failedCount: number;
  totalAmount: number;
  /** Packed funding transactions for public batches; each funds the listed payments. Sign and send all of them. */
  transactions: Array<{ paymentIds: string[]; unsignedTransaction: string; transactionVersion: "legacy" | "v0" }>;
  items: PayoutBatchItemResult[];
}

export interface SentPayoutBatch extends PayoutBatchResult {
  signatures: string[];
  /** Payments whose funding transaction failed to send or confirm. Retry them with a new batch. */
  unfundedPaymentIds: string[];
}

export interface PayoutBatchStatus {
  batchId: string;
  label: string | null;
  itemCount: number;
  failedCount: number;
  totalAmount: number;
  createdAt: string;
  items: Array<{
    rowIndex: number;
    externalRef: string | null;
    amount: number;
    status: "created" | "failed";
    paymentId: string | null;
    /** e.g. OPEN until funded, SUCCESS once funded. A claimed payout shows via the payout.claimed webhook. */
    paymentStatus: string | null;
    error: string | null;
  }>;
}

export interface PortalToken {
  token: string;
  expiresAt: string;
}

export interface PortalLink {
  url: string;
  expiresAt: string;
}

export interface WebhookConfig {
  url: string | null;
  /** Use with verifyWebhook() to check X-Loofta-Signature. Shown here, keep it server-side. */
  secret: string;
}

export interface PayoutWebhookEvent {
  event: "payout.funded" | "payout.claimed";
  payment_id: string;
  batch_id: string;
  row_index: number;
  external_ref: string | null;
  amount: number;
}
