import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const LOG = "[meld/webhook]";
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";
// Meld signs over the exact URL it was configured to call
const WEBHOOK_URL = process.env.MELD_WEBHOOK_URL || "https://pay.loofta.com/api/meld/webhook";
const MAX_SKEW_MS = 10 * 60 * 1000;

type Payload = {
  paymentTransactionId?: string;
  paymentTransactionStatus?: string;
  sessionId?: string;
  externalSessionId?: string;
  externalCustomerId?: string;
};
type MeldEvent = { eventType?: string; payload?: Payload };

/** base64url(HMAC-SHA256(secret, `${timestamp}.${url}.${rawBody}`)) with padding, per Meld's webhook docs. */
function validSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(`${timestamp}.${WEBHOOK_URL}.${rawBody}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function outcome(eventType: string, status: string | undefined): "complete" | "failed" | "pending" {
  const s = String(status || "").toUpperCase();
  const e = eventType.toUpperCase();
  if (s === "SETTLED" || s === "COMPLETED" || e.endsWith("_COMPLETE") || e.endsWith("_SETTLED")) return "complete";
  if (["ERROR", "FAILED", "DECLINED", "REFUNDED", "CANCELLED", "EXPIRED", "VOIDED"].includes(s) || e.endsWith("_FAILED") || e.endsWith("_ERROR")) return "failed";
  return "pending";
}

/** USDC the buyer actually received, read from Meld (webhooks don't carry amounts). */
async function fetchReceivedUsdc(transactionId: string): Promise<number | null> {
  try {
    const res = await fetch(`${MELD_API_BASE}/payments/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `BASIC ${process.env.MELD_API_KEY}`, "Meld-Version": "2026-05-01" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json() as { transaction?: { destinationAmount?: number }; destinationAmount?: number };
    const amount = Number((data.transaction ?? data).destinationAmount);
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const secret = process.env.MELD_WEBHOOK_SECRET;
  if (!secret) {
    console.error(`${LOG} MELD_WEBHOOK_SECRET is not set; rejecting`);
    return new NextResponse(null, { status: 503 });
  }

  // The signature covers the raw bytes, so read the text before any parsing
  const rawBody = await request.text();
  const signature = request.headers.get("meld-signature") || "";
  const timestamp = request.headers.get("meld-signature-timestamp") || "";
  const ts = Date.parse(timestamp);
  if (!signature || !timestamp || Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS || !validSignature(secret, timestamp, rawBody, signature)) {
    return new NextResponse(null, { status: 401 });
  }

  let event: MeldEvent;
  try { event = JSON.parse(rawBody) as MeldEvent; } catch { return new NextResponse(null, { status: 400 }); }
  const eventType = String(event.eventType || "");
  const p = event.payload ?? {};
  if (!eventType.startsWith("TRANSACTION_CRYPTO_")) return NextResponse.json({ ok: true });

  const state = outcome(eventType, p.paymentTransactionStatus);
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  try {
    // Card / Apple Pay deposit: we named the session, so the row is found by our own id
    if (p.externalSessionId?.startsWith("dep_")) {
      const updates: Record<string, unknown> = { updated_at: now };
      if (state === "complete") {
        updates.status = "complete";
        const received = p.paymentTransactionId ? await fetchReceivedUsdc(p.paymentTransactionId) : null;
        if (received) updates.amount_usdc = received;
      } else if (state === "failed") {
        updates.status = "failed";
      }
      if (updates.status) {
        // Never move a finished deposit backwards if events arrive out of order
        await supabase.from("user_deposits").update(updates).eq("provider_order_id", p.externalSessionId).eq("status", "pending");
      }
      return NextResponse.json({ ok: true });
    }

    // Bank cash-out: the row carries Meld's session id
    if (p.sessionId && state !== "pending") {
      const marker = `meld:${p.sessionId}`;
      const updates = state === "complete"
        ? { status: "COMPLETE", completed_at: now, updated_at: now }
        : { status: "FAILED", error_message: "The payout provider could not complete this cash-out", updated_at: now };
      // Only a row whose USDC was actually sent can finish; a failed provider payout is refunded by them
      await supabase.from("offramp_requests").update(updates).eq("near_intents_status", marker).eq("platform", "meld").eq("status", "DEPOSITED");
    }
  } catch (err) {
    console.error(`${LOG} handler error:`, err instanceof Error ? err.message : String(err));
    // 500 makes Meld retry, which is what we want for a transient DB error
    return new NextResponse(null, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
