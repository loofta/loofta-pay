import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  CreatePartnerBatchParams,
  CreatePayoutBatchParams,
  PartnerBatch,
  SetWithdrawOptionsParams,
  WithdrawOptions,
  PayoutWebhookEvent,
  PayoutBatchResult,
  PayoutBatchStatus,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWithdrawOptions(d: any): WithdrawOptions {
  return {
    showHistory: d.show_history !== false,
    disabledMethods: d.disabled_withdraw_methods ?? [],
    enabledMethods: d.enabled_withdraw_methods ?? [],
  };
}

function mapPartnerBatch(d: any): PartnerBatch {
  return {
    batchId: d.batch_id ?? d.id,
    status: d.status,
    label: d.label ?? null,
    itemCount: d.item_count,
    totalAmount: Number(d.total_amount),
    approveUrl: d.approve_url,
    scheduledFor: d.scheduled_for ?? null,
    scheduledError: d.scheduled_error ?? null,
    items: (d.items ?? []).map((i: any) => ({
      rowIndex: i.row_index,
      email: i.recipient_identifier,
      amount: Number(i.amount),
      externalRef: i.external_ref ?? null,
      status: i.status,
      error: i.error ?? null,
      withdrawn: Boolean(i.withdrawn),
    })),
  };
}

/**
 * Pay many people from your partner account's company wallet. Your server drafts the batch here and
 * sends your admin to `approveUrl`. An API key can never move money: your team approves the batch and
 * your company wallet's signers sign it. Needs "Payout batches" switched on under Developers in the
 * partner portal.
 */
export class PartnerApi {
  constructor(private readonly http: Requester) {}

  /** Drafts a batch of email payouts. Safe to retry with the same idempotencyKey. */
  async createBatch(params: CreatePartnerBatchParams): Promise<PartnerBatch> {
    const d = await this.http.request<unknown>("POST", "/partner-api/batches", {
      idempotency_key: params.idempotencyKey,
      label: params.label,
      scheduled_for: params.scheduledFor === undefined ? undefined : new Date(params.scheduledFor).toISOString(),
      rows: params.rows.map((r) => ({
        recipient_type: "email",
        recipient_identifier: r.email,
        amount: r.amount,
        external_ref: r.externalRef,
        message: r.message,
      })),
    });
    return mapPartnerBatch(d);
  }

  /** Where a batch stands and what happened to each payout. */
  async getBatch(batchId: string): Promise<PartnerBatch> {
    return mapPartnerBatch(await this.http.request<unknown>("GET", `/partner-api/batches/${encodeURIComponent(batchId)}`));
  }

  /** Your most recent batches, newest first (items are not included, use getBatch for those). */
  async listBatches(params: { limit?: number } = {}): Promise<PartnerBatch[]> {
    const q = params.limit ? `?limit=${encodeURIComponent(String(params.limit))}` : "";
    const d = await this.http.request<{ batches: unknown[] }>("GET", `/partner-api/batches${q}`);
    return (d.batches ?? []).map(mapPartnerBatch);
  }

  /**
   * Calls off a batch that is still waiting for approval, or approved and not yet prepared. Once payouts exist
   * (awaiting funding or later) it is refused: those are funded or left to lapse from the portal.
   */
  async cancelBatch(batchId: string): Promise<PartnerBatch> {
    return mapPartnerBatch(await this.http.request<unknown>("POST", `/partner-api/batches/${encodeURIComponent(batchId)}/cancel`, {}));
  }

  /**
   * Sets (or clears with null) the https URL that receives signed payout and batch events, and returns the
   * secret to pass to `verifyWebhook`. Events: payout.funded, payout.claimed, payout.withdrawn, batch.created,
   * batch.approved, batch.ready_to_fund, batch.executed, batch.cancelled, batch.schedule_failed.
   */
  async setWebhook(url: string | null): Promise<{ url: string | null; secret: string }> {
    const d = await this.http.request<{ url: string | null; secret: string }>("POST", "/partner-api/webhook", { url });
    return { url: d.url ?? null, secret: d.secret };
  }

  /** What your recipients can do on your withdraw page: payout history and which cash-out routes are on. */
  async getWithdrawOptions(): Promise<WithdrawOptions> {
    return mapWithdrawOptions(await this.http.request<unknown>("GET", "/partner-api/withdraw-options"));
  }

  /**
   * Show or hide payout history, and switch cash-out routes on or off. Everything is on by default. Send only what
   * you want to change. At least one route must stay on, and recipients always keep their money.
   */
  async setWithdrawOptions(params: SetWithdrawOptionsParams): Promise<WithdrawOptions> {
    const d = await this.http.request<unknown>("POST", "/partner-api/withdraw-options", {
      show_history: params.showHistory,
      disabled_withdraw_methods: params.disabledMethods,
    });
    return mapWithdrawOptions(d);
  }
}

/** The payout portal your users see: a hosted page, or the @loofta/portal components. */
export class PortalApi {
  constructor(private readonly http: Requester) {}

  /**
   * Token for the embedded `<Payouts getToken=... />` widget. 15 minutes, one user. Identify the
   * user by the email or handle you paid, or by the id you imported them with. Call this from your
   * server with a partner API key; the key never goes to the browser.
   */
  async createToken(params: {
    email?: string;
    platform?: "twitter" | "discord" | "github" | "telegram";
    handle?: string;
    externalUserId?: string;
    returnUrl?: string;
  }): Promise<PortalToken> {
    const d = await this.http.request<any>("POST", "/partner-portal/token", {
      email: params.email,
      platform: params.platform,
      handle: params.handle,
      external_user_id: params.externalUserId,
      return_url: params.returnUrl,
    });
    return { token: d.token, expiresAt: d.expires_at };
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
export function verifyWebhook<T = PayoutWebhookEvent>(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string): T {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const given = signatureHeader ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid Loofta webhook signature");
  return JSON.parse(body);
}
