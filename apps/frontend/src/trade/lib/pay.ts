import { api } from "@/trade/lib/api";

/** Pay by username: your link, sending, and history. The Loofta backend does the work, same routes as the web app. */

export interface PayProfile {
  username: string | null;
  link: string | null;
}

export interface PayHistoryItem {
  id: string;
  kind: "sent" | "received" | "deposit";
  amount: number;
  who: string;
  status: string;
  at: string;
  /** Received, but still waiting for you to claim it into your wallet. */
  claimable?: boolean;
}

export type RecipientType = "username" | "email" | "telegram" | "twitter" | "discord" | "github";

export interface SendTx {
  transactionBase64: string;
  payment_ids: string[];
  networkFeeUsdc: number;
}

export interface SendBuilt {
  totalAmountUsdc: number;
  networkFeeUsdc: number;
  links: Array<{ id: string; link: string; recipient_identifier: string; amount: string }>;
  /** Large batches are split into several transactions. A single recipient is always one. */
  transactions?: SendTx[];
  transactionBase64: string;
  payment_ids: string[];
}

export const getPayProfile = (token: string | null) => api<PayProfile>("/mini/pay/profile", { token });
export const setPayUsername = (username: string, token: string | null) => api<PayProfile>("/mini/pay/username", { body: { username }, token });
export const getPayHistory = (token: string | null) => api<PayHistoryItem[]>("/mini/pay/history", { token });
/** Claim one payment waiting for you (by id), or everything waiting. */
export const claimPayments = (token: string | null, id?: string) => api<{ claimedUsd: number; claimed: number; failed: number }>("/mini/pay/claim", { body: id ? { id } : {}, token });

/** Whether this person is on Loofta, and whether their first payment needs a claim link. Public, no sign in. */
export const payTarget = (kind: RecipientType, value: string) => {
  const q = kind === "discord" || kind === "github" || kind === "telegram" ? `kind=social&platform=${kind}` : `kind=${kind}`;
  return api<{ registered: boolean; requirePrivatePayments: boolean; needsClaim: boolean }>(`/users/pay-target?${q}&value=${encodeURIComponent(value)}`);
};

export const buildSend = (b: { recipients: Array<{ amount: number; recipient_type: RecipientType; recipient_identifier: string; message?: string }>; sender_wallet: string }, token: string | null) =>
  api<SendBuilt>("/send-payment/multi-build", { body: { ...b, cluster: "mainnet" }, token });

export const confirmSend = (b: { payment_ids: string[]; tx_hash: string; fee_usdc: number }, token: string | null) => api<{ ok: boolean }>("/send-payment/multi-confirm", { body: b, token });

/** Where personal links and claim pages live. */
export const PAY_BASE = (process.env.NEXT_PUBLIC_PAY_BASE_URL || "https://pay.loofta.com").replace(/\/$/, "");


// ---- Direct private payment: the same routes the web app uses (create the claim, build the MagicBlock transfer, sign, send) ----

export interface PrivateTx {
  transactionBase64: string;
  version?: string;
  /** "ephemeral" means the transaction goes to MagicBlock's rollup RPC, not to Solana. */
  sendTo?: string;
  feeAmountUsdc?: number;
}

/** How the transfer is spread out so it cannot be matched by timing. Same defaults as the web Send form. */
export const PRIVATE_SPREAD_MS = 10 * 60_000;
export const randomSplit = () => 2 + Math.floor(Math.random() * 14);
export const MAGICBLOCK_RPC = (process.env.NEXT_PUBLIC_MAGICBLOCK_URL || "https://mainnet-tee.magicblock.app").replace(/\?.*$/, "").trim();

/** Creates the payment record for a private send. Nothing moves until the transfer is signed. */
export function createPrivateClaim(kind: RecipientType, identifier: string, amount: number, message: string | undefined, split: number, token: string | null) {
  const common = { amount, isPrivate: true, cluster: "mainnet", description: message || undefined, split, maxDelayMs: PRIVATE_SPREAD_MS };
  if (kind === "email") return api<{ id: string; short_id?: string | null }>("/claims/create-from-email", { body: { email: identifier.trim().toLowerCase(), ...common }, token });
  if (kind === "discord" || kind === "github" || kind === "telegram") return api<{ id: string; short_id?: string | null }>("/claims/create-from-social", { body: { platform: kind, handle: identifier, ...common }, token });
  return api<{ id: string; short_id?: string | null }>("/claims/create-from-username", { body: { username: identifier, treatUnregisteredAsTwitter: kind === "twitter", ...common }, token });
}

export const buildPrivateTransfer = (claimId: string, senderWallet: string, split: number, token: string | null) =>
  api<PrivateTx>(`/claims/${encodeURIComponent(claimId)}/build-private-transfer`, { body: { sender_wallet: senderWallet, cluster: "mainnet", gasless: true, split, max_delay_ms: PRIVATE_SPREAD_MS }, token });

/** Saved as soon as the transfer is sent, so support can find it if confirmation is slow. */
export const saveTxHash = (claimId: string, txHash: string, token: string | null) =>
  api<unknown>(`/claims/${encodeURIComponent(claimId)}/tx-hash`, { method: "PATCH", body: { txHash }, token });

export const markPrivateSent = (claimId: string, txHash: string, feeUsdc: number | undefined, token: string | null) =>
  api<unknown>(`/claims/${encodeURIComponent(claimId)}/status`, {
    body: { status: "SUCCESS", txHash, paidWith: "USDC (Private)", isPrivate: true, paidWithToken: "USDC", paidWithChain: "solana", ...(feeUsdc != null ? { feeAmountUsdc: feeUsdc } : {}) },
    token,
  });

// ---- Private send of any token to any Solana address: the same backend routes the web wallet uses ----

export interface PrivateSendBuild {
  id?: string;
  transactionBase64: string;
  version?: string;
  sendTo?: string;
  /** USDC sends */
  feeAmountUsdc?: number;
  /** Other tokens: the fee in the token and in dollars */
  feeAmountToken?: number;
  feeAmountUsd?: number;
}

/** How long delivery can be spread out, and in how many pieces. Same as the web wallet. */
const SPREAD_MS = 10 * 60_000;
const splitCount = () => 2 + Math.floor(Math.random() * 14);

/** USDC: your wallet to a one-time relay wallet, then the server delivers to the address. */
export const buildPrivateUsdcSend = (amountUsdc: number, destination: string, token: string | null) =>
  api<PrivateSendBuild & { id: string }>("/private-balance/withdrawal/build", { body: { amount_usdc: amountUsdc, destination_address: destination, cluster: "mainnet", split: splitCount(), max_delay_ms: SPREAD_MS }, token });

/** Any other priced token, SOL included (mint So111...). Needs about 0.003 SOL for the network fee. */
export const buildPrivateTokenSend = (mint: string, amount: string, destination: string, token: string | null) =>
  api<PrivateSendBuild>("/private-balance/withdrawal/build-token", { body: { mint, amount, destination_address: destination, split: splitCount(), max_delay_ms: SPREAD_MS }, token });

export const recordPrivateSendSignature = (id: string, signature: string, token: string | null) =>
  api<unknown>(`/private-balance/withdrawal/${encodeURIComponent(id)}/signature`, { body: { signature }, token });
