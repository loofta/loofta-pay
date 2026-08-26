import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import type { LooftaPayClientOptions, PayHumanParams, PayHumanResult, CreatePaymentLinkParams, CreatePaymentLinkResult, PaymentLinkStatus } from "./types";

const DEFAULT_BASE_URL = "https://api.loofta.xyz";
const USDC_DECIMALS = 6;

// Mirrors @x402/svm's exported constants (SOLANA_MAINNET_CAIP2, SOLANA_DEVNET_CAIP2,
// USDC_MAINNET_ADDRESS, USDC_DEVNET_ADDRESS) — not imported directly to keep this package's
// dependency footprint small (that package pulls in @solana/kit, viem, and wagmi, none of which
// this SDK otherwise needs); the resource server (apps/backend) imports them directly instead.
const NETWORK_USDC_MINT: Record<string, string> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};
const NETWORK_RPC_URL: Record<string, string> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com",
};

interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

function toKeypair(signer: LooftaPayClientOptions["signer"]): Keypair {
  if (signer instanceof Uint8Array) return Keypair.fromSecretKey(signer);
  if (typeof signer === "string") return Keypair.fromSecretKey(bs58.decode(signer));
  if (signer && "secretKey" in signer) return Keypair.fromSecretKey(signer.secretKey);
  throw new Error("Invalid signer — expected a Uint8Array secret key, base58 string, or Keypair");
}

function toRequestBody(params: PayHumanParams) {
  const amountUsd = typeof params.amount === "string" ? parseFloat(params.amount) : params.amount;
  return {
    recipient_type: params.to.type,
    recipient_identifier: params.to.value,
    amount_usd: amountUsd,
    description: params.description,
  };
}

/**
 * Client for the Loofta Pay Protocol — pay any human by email, username, or social handle.
 *
 * Two independent transports, chosen by what you construct the client with:
 *   - `apiKey`: plain REST call to /integrators/v1/pay-human. Returns a deposit address; your
 *     own system is responsible for actually sending the USDC there.
 *   - `signer`: the x402 path. No account/API key needed at all — the SDK drives the full
 *     402 -> sign -> settle round trip against /x402/pay-human using your own Solana keypair,
 *     and only resolves once the payment is confirmed funded on-chain.
 */
export class LooftaPayClient {
  private readonly apiKey?: string;
  private readonly signer?: Keypair;
  private readonly baseUrl: string;

  constructor(options: LooftaPayClientOptions) {
    if (!options.apiKey && !options.signer) {
      throw new Error("LooftaPayClient requires either `apiKey` or `signer`");
    }
    this.apiKey = options.apiKey;
    this.signer = options.signer ? toKeypair(options.signer) : undefined;
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  }

  async payHuman(params: PayHumanParams): Promise<PayHumanResult> {
    return this.apiKey ? this.payHumanViaApiKey(params) : this.payHumanViaX402(params);
  }

  /**
   * Creates a checkout link that pays YOU (the API key owner) — the receive side of the Loofta
   * Pay Protocol. Requires an API key with the `payment_links:create` scope (self-serve, minted
   * from the Loofta app's Developer settings). Not available on the x402/signer path.
   */
  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    if (!this.apiKey) throw new Error("createPaymentLink requires an API key");
    const res = await fetch(`${this.baseUrl}/payment-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        amount: params.amount,
        message: params.message,
        is_private: params.isPrivate,
        webhook_url: params.webhookUrl,
        return_url: params.returnUrl,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return {
      shortId: data.short_id,
      url: data.url,
      amount: data.amount,
      message: data.message ?? null,
      webhookSecret: data.webhook_secret ?? null,
    };
  }

  /**
   * Polls a payment link's status — the alternative to webhookUrl for whoever'd rather check than
   * be pushed to. Only ever sees your own links (a short_id belonging to a different API key 404s).
   */
  async getPaymentLinkStatus(shortId: string): Promise<PaymentLinkStatus> {
    if (!this.apiKey) throw new Error("getPaymentLinkStatus requires an API key");
    const res = await fetch(`${this.baseUrl}/payment-links/${shortId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return {
      shortId: data.short_id,
      status: data.status,
      paid: data.paid === true,
      amount: data.amount,
      message: data.message ?? null,
      paidAt: data.paid_at ?? null,
    };
  }

  private async payHumanViaApiKey(params: PayHumanParams): Promise<PayHumanResult> {
    const res = await fetch(`${this.baseUrl}/integrators/v1/pay-human`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(toRequestBody(params)),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return {
      paymentId: data.payment_id,
      shortId: data.short_id,
      claimLink: data.claim_link,
      status: "PENDING_DEPOSIT",
      depositAddress: data.deposit_address,
      requiredAmountBaseUnits: data.required_amount_base_units,
    };
  }

  private async payHumanViaX402(params: PayHumanParams): Promise<PayHumanResult> {
    if (!this.signer) throw new Error("x402 path requires a signer");
    const body = JSON.stringify(toRequestBody(params));

    const challengeRes = await fetch(`${this.baseUrl}/x402/pay-human`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (challengeRes.status !== 402) {
      const data = await challengeRes.json().catch(() => null);
      throw new Error(data?.message || `Expected 402 Payment Required, got ${challengeRes.status}`);
    }
    const paymentRequired = await challengeRes.json();
    const requirements: PaymentRequirements | undefined = paymentRequired.accepts?.[0];
    if (!requirements) throw new Error("Resource server returned no payment requirements");

    const mint = NETWORK_USDC_MINT[requirements.network];
    const rpcUrl = NETWORK_RPC_URL[requirements.network];
    if (!mint || !rpcUrl) throw new Error(`Unsupported network: ${requirements.network}`);

    const connection = new Connection(rpcUrl, "confirmed");
    const mintPubkey = new PublicKey(mint);
    const payToPubkey = new PublicKey(requirements.payTo); // already the destination token account
    const sourceAta = await getAssociatedTokenAddress(mintPubkey, this.signer.publicKey);

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.signer.publicKey, recentBlockhash: blockhash });
    transaction.add(
      createTransferCheckedInstruction(
        sourceAta,
        mintPubkey,
        payToPubkey,
        this.signer.publicKey,
        BigInt(requirements.amount),
        USDC_DECIMALS,
      ),
    );
    transaction.sign(this.signer);
    // The client signs but does not broadcast — the facilitator submits this during settle(),
    // per the x402 protocol (see @x402/svm's ExactSvmPayloadV1: { transaction: base64 }).
    const serializedTransaction = transaction.serialize({ requireAllSignatures: true }).toString("base64");

    const paymentPayload = {
      x402Version: paymentRequired.x402Version,
      accepted: requirements,
      payload: { transaction: serializedTransaction },
    };
    const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    const settleRes = await fetch(`${this.baseUrl}/x402/pay-human`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PAYMENT": xPaymentHeader },
      body,
    });
    const data = await settleRes.json().catch(() => null);
    if (!settleRes.ok) throw new Error(data?.message || `Settlement failed (${settleRes.status})`);

    return {
      paymentId: data.payment_id,
      shortId: null,
      claimLink: data.claim_link,
      status: "FUNDED",
    };
  }
}
