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
