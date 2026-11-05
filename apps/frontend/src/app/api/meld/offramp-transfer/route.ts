import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const LOG = "[meld/offramp-transfer]";
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";
const SESSION_RE = /^[A-Za-z0-9]{10,40}$/;

type MeldTx = {
  id?: string;
  status?: string;
  transactionType?: string;
  sourceAmount?: number;
  sourceCurrencyCode?: string;
  destinationAmount?: number;
  destinationCurrencyCode?: string;
  serviceProvider?: string;
  externalCustomerId?: string | null;
  customer?: { externalCustomerId?: string | null } | null;
  cryptoDetails?: { destinationWalletAddress?: string | null; sourceWalletAddress?: string | null } | null;
  offrampDestinationWalletAddress?: string | null;
};

function meldHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `BASIC ${process.env.MELD_API_KEY}`,
    "Meld-Version": "2026-05-01",
  };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isSolanaAddress(v: string): boolean {
  try { new PublicKey(v); return true; } catch { return false; }
}

// Meld statuses we treat as final. Anything else means the payout is still on its way.
function payoutState(status: string | undefined): "paid" | "failed" | "pending" {
  const s = String(status || "").toUpperCase();
  if (s === "SETTLED" || s === "COMPLETED") return "paid";
  if (["ERROR", "FAILED", "DECLINED", "REFUNDED", "CANCELLED", "EXPIRED", "VOIDED"].includes(s)) return "failed";
  return "pending";
}

async function loadMeldTx(sessionId: string): Promise<{ tx?: MeldTx; notReady?: boolean; error?: string }> {
  const res = await fetch(`${MELD_API_BASE}/payments/transactions/sessions/${encodeURIComponent(sessionId)}`, {
    headers: meldHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) return { notReady: true };
  if (!res.ok) {
    console.error(`${LOG} Meld ${res.status}:`, (await res.text()).slice(0, 400));
    return { error: "Could not reach the payout provider." };
  }
  const data = await res.json() as { transaction?: MeldTx } & MeldTx;
  return { tx: data.transaction ?? data };
}

/**
 * GET ?sessionId=... — after the user confirms the quote in Meld's widget and is sent back, read the provider's
 * deposit address from Meld (server side, never from the browser), bind it to a Loofta offramp row owned by the
 * caller, and return what the user needs to confirm. The row is what lets the fee-payer sponsor co-sign the send:
 * it only signs a transfer to exactly that address, for exactly that user.
 */
export async function GET(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (!process.env.MELD_API_KEY) return json({ error: "Cash-out isn't configured." }, 503);

  const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
  if (!SESSION_RE.test(sessionId)) return json({ error: "Invalid session" }, 400);

  const supabase = getSupabaseAdmin();
  const marker = `meld:${sessionId}`;
  const { data: existing } = await supabase
    .from("offramp_requests")
    .select("id, user_id, status, amount_usdc, near_intents_deposit_address, near_intents_memo")
    .eq("near_intents_status", marker)
    .maybeSingle();
  if (existing && existing.user_id !== userId) return json({ error: "Session not found" }, 404);

  const { tx, notReady, error } = await loadMeldTx(sessionId);
  if (error) return json({ error }, 502);
  if (notReady || !tx) return json({ ready: false });

  // The session must be one we created for this exact user, selling Solana USDC.
  const owner = tx.externalCustomerId ?? tx.customer?.externalCustomerId ?? null;
  if (owner !== userId && process.env.NODE_ENV !== "development") return json({ error: "Session not found" }, 404);
  if (tx.sourceCurrencyCode !== "USDC_SOLANA") return json({ error: "Unsupported asset for this cash-out." }, 400);

  const state = payoutState(tx.status);
  const sentAlready = existing?.near_intents_memo?.startsWith("meld_tx:") ?? false;

  if (existing && sentAlready) {
    if (state === "paid" && existing.status !== "COMPLETE") {
      await supabase.from("offramp_requests").update({ status: "COMPLETE", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", existing.id);
    }
    return json({ ready: true, sent: true, state, offrampId: existing.id, amountUsdc: Number(existing.amount_usdc), receive: tx.destinationAmount ?? null, currency: tx.destinationCurrencyCode ?? "USD", provider: tx.serviceProvider ?? null });
  }

  const depositAddress = String(tx.cryptoDetails?.destinationWalletAddress || tx.offrampDestinationWalletAddress || "").trim();
  const amount = Number(tx.sourceAmount);
  if (!depositAddress || !isSolanaAddress(depositAddress) || !(amount > 0)) {
    // The provider hasn't produced a deposit address yet (user still in the widget)
    return json({ ready: false });
  }
  if (state === "failed") return json({ ready: true, sent: false, state, error: "This cash-out was cancelled by the provider." });

  const fields = {
    near_intents_deposit_address: depositAddress,
    amount_usdc: amount,
    platform_identifier: tx.serviceProvider ?? "meld",
    updated_at: new Date().toISOString(),
  };
  let offrampId = existing?.id as string | undefined;
  if (offrampId) {
    // Re-point only while nothing has been sent: a sent row's destination must never change.
    await supabase.from("offramp_requests").update(fields).eq("id", offrampId).eq("status", "PENDING_BRIDGE");
  } else {
    const walletAddress = tx.cryptoDetails?.sourceWalletAddress || "";
    const { data: created, error: insertError } = await supabase
      .from("offramp_requests")
      .insert({
        user_id: userId,
        platform: "meld",
        currency: String(tx.destinationCurrencyCode || "USD").toUpperCase(),
        user_solana_address: walletAddress,
        near_intents_status: marker,
        status: "PENDING_BRIDGE",
        ...fields,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      console.error(`${LOG} insert failed:`, insertError?.message);
      return json({ error: "Could not prepare the transfer." }, 500);
    }
    offrampId = created.id as string;
  }

  return json({
    ready: true,
    sent: false,
    state,
    offrampId,
    depositAddress,
    amountUsdc: amount,
    receive: tx.destinationAmount ?? null,
    currency: tx.destinationCurrencyCode ?? "USD",
    provider: tx.serviceProvider ?? null,
  });
}

/** POST { offrampId, signature } — the USDC left the wallet; remember it so the page shows payout status. */
export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  let body: { offrampId?: string; signature?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body.offrampId || !body.signature || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(body.signature)) {
    return json({ error: "offrampId and signature are required" }, 400);
  }
  const { data, error } = await getSupabaseAdmin()
    .from("offramp_requests")
    .update({ status: "DEPOSITED", near_intents_memo: `meld_tx:${body.signature}`, updated_at: new Date().toISOString() })
    .eq("id", body.offrampId)
    .eq("user_id", userId)
    .eq("platform", "meld")
    .select("id");
  if (error || !data?.length) return json({ error: "Transfer not found" }, 404);
  return json({ ok: true });
}
