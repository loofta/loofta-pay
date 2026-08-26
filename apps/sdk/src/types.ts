export type RecipientType = "email" | "username" | "twitter" | "discord" | "github" | "telegram";

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
  /** USD amount the recipient (the API key owner) should net. $5 minimum — every payment link is
   *  private, and the private-transfer path enforces a $5 floor. */
  amount: number;
  /** Shown to the payer on the checkout page. */
  message?: string;
  /** Defaults to true — the amount and that it went to you are shielded on-chain, $5 minimum.
   *  Pass false for a plain public transfer instead ($1 minimum) — the amount and your wallet
   *  become visible on-chain. */
  isPrivate?: boolean;
  /** POSTed with a signed "payment.succeeded" event once this link is paid — see
   *  CreatePaymentLinkResult.webhookSecret for verifying the signature. */
  webhookUrl?: string;
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
}
