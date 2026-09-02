import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const LOG = "[peer-pay/webhook]";
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

// Peer Pay webhook receiver — see docs.pay.peer.xyz. Sandbox and live deliver to separate routes
// (/webhook/sandbox, /webhook/live), each verified against its own signing secret only. Never
// accept either secret on either route: the sandbox key is handled far more loosely than live, so
// a handler that accepts both lets anyone with sandbox access forge a live ORDER_FULFILLED event.
//
// We don't credit any balance from this handler. `destinationAddress` on every Peer Pay order is
// a one-time Near Intents deposit address (see /api/peer-pay/checkout and BalanceModal.tsx's
// handlePeerDeposit) — the existing bridge-status polling that already drives every other
// cross-chain top-up is what actually completes the deposit once funds land there. This handler
// only exists to (a) satisfy Peer's own webhook-verification requirement and (b) mark a
// user_deposits row "failed" if the order expires unpaid, so it doesn't sit at "pending" forever.

function timingSafeEqualHex(expectedHex: string, receivedHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex, "hex");
    const b = Buffer.from(receivedHex, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: Request, props: { params: Promise<{ env: string }> }) {
  const { env } = await props.params;
  if (env !== "sandbox" && env !== "live") {
    return new NextResponse("Not found", { status: 404 });
  }

  const secret = env === "live" ? process.env.PEER_PAY_WEBHOOK_SECRET_LIVE : process.env.PEER_PAY_WEBHOOK_SECRET_SANDBOX;
  if (!secret) {
    console.error(`${LOG} Missing PEER_PAY_WEBHOOK_SECRET_${env.toUpperCase()}`);
    return new NextResponse("Not configured", { status: 503 });
  }

  const timestampHeader = request.headers.get("x-webhook-timestamp");
  const signatureHeader = request.headers.get("x-webhook-signature");
  if (!timestampHeader || !signatureHeader) {
    return new NextResponse("Missing signature headers", { status: 400 });
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return new NextResponse("Stale or invalid timestamp", { status: 400 });
  }

  // Raw bytes — verification must run against the exact body received, before any JSON parsing.
  // JSON.stringify(JSON.parse(rawBody)) is not guaranteed to reproduce the same bytes (whitespace,
  // key order), which silently breaks every signature if you verify against the re-parsed form.
  const rawBody = await request.text();
  const expectedSignature = createHmac("sha256", secret).update(`${timestampHeader}.${rawBody}`).digest("hex");
  if (!timingSafeEqualHex(expectedSignature, signatureHeader)) {
    console.error(`${LOG} Signature mismatch (env=${env})`);
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let event: { type?: string; data?: { order?: { id?: string } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  // Best-effort bookkeeping, never blocks the 2xx response. Idempotent: the `status = 'pending'`
  // guard means a duplicate delivery finds nothing left to update.
  if (event?.type === "PAYMENT_EXPIRED") {
    const orderId = event?.data?.order?.id;
    if (orderId) {
      try {
        const supabase = getSupabaseAdmin();
        await supabase
          .from("user_deposits")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("provider_order_id", orderId)
          .eq("type", "peer-pay")
          .eq("status", "pending");
      } catch (err) {
        console.error(`${LOG} Failed to mark expired deposit for order ${orderId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}
