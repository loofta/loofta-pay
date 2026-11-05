import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  CreatePayoutBatchParams,
  PayoutWebhookEvent,
  PayoutBatchResult,
  PayoutBatchStatus,
  PortalLink,
  PortalToken,
  SentPayoutBatch,
  WebhookConfig,
} from "./types";

/** Minimal HTTP surface the client hands to the namespaces below (keeps auth in one place). */
export interface Requester {
  request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T>;
  readonly signer?: Keypair;
  readonly rpcUrl?: string;
}

const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

function toBatchBody(params: CreatePayoutBatchParams, senderWallet: string) {
  return {
    idempotency_key: params.idempotencyKey,
    label: params.label,
    sender_wallet: senderWallet,
    is_private: params.isPrivate,
    rows: params.rows.map((r) => ({
      amount: r.amount,
      recipient_type: r.to.type,
      recipient_identifier: r.to.value,
      external_ref: r.externalRef,
      message: r.message,
    })),
  };
}

function mapBatch(data: any): PayoutBatchResult {
  return {
    batchId: data.batch_id,
    itemCount: data.item_count,
    failedCount: data.failed_count,
    totalAmount: data.total_amount,
    transactions: (data.transactions ?? []).map((t: any) => ({
      paymentIds: t.payment_ids,
      unsignedTransaction: t.unsigned_transaction,
      transactionVersion: t.transaction_version,
    })),
    items: (data.items ?? []).map((i: any) => ({
      rowIndex: i.row_index,
      externalRef: i.external_ref ?? null,
      status: i.status,
      paymentId: i.payment_id ?? null,
      claimLink: i.claim_link ?? null,
      error: i.error ?? null,
      unsignedTransaction: i.unsigned_transaction ?? null,
    })),
  };
}

/** Bulk payouts: pay up to 100 people in one call. */
export class PayoutsApi {
  constructor(private readonly http: Requester) {}

  /**
   * Creates the payouts and returns packed, unsigned transactions (several payees per
   * transaction, so fewer signatures and fees). You sign and send them with your own wallet.
   * Safe to retry with the same idempotencyKey: you get the existing batch's status back.
   */
  async createBatch(params: CreatePayoutBatchParams & { senderWallet: string }): Promise<PayoutBatchResult> {
    const data = await this.http.request<unknown>("POST", "/payouts/batches", toBatchBody(params, params.senderWallet));
    return mapBatch(data);
  }

  /**
   * Server-side one call: creates the batch, signs every transaction with the client's `signer`,
   * broadcasts them, and waits for confirmation. Requires the client to be built with an
   * `apiKey` AND a `signer`. Use `rpcUrl` on the client for a private RPC in production.
   */
  async sendBatch(params: CreatePayoutBatchParams): Promise<SentPayoutBatch> {
    const signer = this.http.signer;
    if (!signer) throw new Error("sendBatch requires the client to be constructed with a `signer`");
    const batch = await this.createBatch({ ...params, senderWallet: signer.publicKey.toBase58() });
    if (params.isPrivate) {
      throw new Error("sendBatch does not support private batches; use createBatch and sign each item's transaction.");
    }
    const connection = new Connection(this.http.rpcUrl || DEFAULT_MAINNET_RPC, "confirmed");
    const signatures: string[] = [];
    const failedPaymentIds: string[] = [];
    for (const t of batch.transactions) {
      try {
        const tx = Transaction.from(Buffer.from(t.unsignedTransaction, "base64"));
        tx.partialSign(signer);
        const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        const latest = await connection.getLatestBlockhash("confirmed");
        const result = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
        if (result.value.err) throw new Error(JSON.stringify(result.value.err));
        signatures.push(sig);
      } catch {
        failedPaymentIds.push(...t.paymentIds);
      }
    }
    return { ...batch, signatures, unfundedPaymentIds: failedPaymentIds };
  }

  async getBatch(batchId: string): Promise<PayoutBatchStatus> {
    const d = await this.http.request<any>("GET", `/payouts/batches/${encodeURIComponent(batchId)}`);
    return {
      batchId: d.id,
      label: d.label ?? null,
      itemCount: d.item_count,
      failedCount: d.failed_count,
      totalAmount: Number(d.total_amount),
      createdAt: d.created_at,
      items: (d.items ?? []).map((i: any) => ({
        rowIndex: i.row_index,
        externalRef: i.external_ref ?? null,
        amount: Number(i.amount),
        status: i.status,
        paymentId: i.payment_id ?? null,
        paymentStatus: i.payment_status ?? null,
        error: i.error ?? null,
      })),
    };
  }
}

/** The payout portal your users see: a hosted page, or the @loofta/portal components. */
export class PortalApi {
  constructor(private readonly http: Requester) {}

  /** Token for the embedded `<PayoutPortal getToken=... />`. 15 minutes, one user. */
  async createToken(params: { externalUserId: string; displayName?: string }): Promise<PortalToken> {
    const d = await this.http.request<any>("POST", "/payouts/portal-token", {
      external_user_id: params.externalUserId,
      display_name: params.displayName,
    });
    return { token: d.token, expiresAt: d.expires_at };
  }

  /** Hosted portal: redirect your user to `url`. They see their payouts and withdraw, then go back to returnUrl. */
  async createLink(params: { externalUserId: string; displayName?: string; returnUrl?: string }): Promise<PortalLink> {
    const d = await this.http.request<any>("POST", "/payouts/portal-link", {
      external_user_id: params.externalUserId,
      display_name: params.displayName,
      return_url: params.returnUrl,
    });
    return { url: d.url, expiresAt: d.expires_at };
  }
}

export class WebhooksApi {
  constructor(private readonly http: Requester) {}

  /** Set (or clear with null) the https URL for payout.funded and payout.claimed events. */
  async set(url: string | null): Promise<WebhookConfig> {
    const d = await this.http.request<any>("POST", "/payouts/webhook", { url });
    return { url: d.webhook_url ?? null, secret: d.webhook_secret };
  }
}

/**
 * Verify an incoming webhook. Pass the RAW request body (not parsed JSON), the
 * X-Loofta-Signature header, and the secret from `webhooks.set`. Returns the parsed event, or
 * throws if the signature is wrong.
 */
export function verifyWebhook(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string): PayoutWebhookEvent {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const given = signatureHeader ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid Loofta webhook signature");
  return JSON.parse(body);
}
