'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { extractChainsFromAssets } from "@/lib/assetUtils";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";
/** Must match ClaimsService.RECIPIENT_CLAIM_LOCK_TTL_MS (backend claims.service.ts). */
const RECIPIENT_CLAIM_LOCK_TTL_MS = 5 * 60_000;

async function getVerifiedUserId(request: Request): Promise<string | null> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const res = await fetch(`${backendUrl}/users/me`, {
        headers: { authorization: authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[payments/PATCH] Backend JWT verify failed:", e);
    }
    return null;
  }

  const legacyId = request.headers.get("x-privy-user-id");
  if (legacyId) {
    try {
      const res = await fetch(`${backendUrl}/users/me`, {
        headers: { "x-privy-user-id": legacyId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[payments/PATCH] Backend legacy-ID verify failed:", e);
    }
    return null;
  }

  return null;
}

/**
 * Adds backward-compat aliases to a payments row so the payment page
 * (which still references to_symbol, to_chain, claim_burner_address) keeps working.
 */
function normalisePayment(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    // Destination is always USDC on Solana (real columns in payments, compat alias for UI)
    to_symbol: "USDC",
    // Alias burner_address → claim_burner_address for legacy UI code
    claim_burner_address: raw.burner_address ?? null,
    // Compat aliases for old field names still consumed by page.tsx
    paid_with_chain: raw.from_chain ?? null,
    paid_with_token: raw.from_token ?? null,
    // Removed fields — default to null so UI doesn't break
    creator_email: null,
    // Short URL identifier — null for payments created before short links were introduced
    short_id: raw.short_id ?? null,
  };
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = getSupabaseAdmin();

  // Try payments table first; fall back to legacy claims
  let rawPayment: Record<string, unknown> | null = null;
  let isLegacy = false;

  const { data: paymentRow } = await supabase
    .from("payments")
    .select("id, short_id, amount, direction, status, created_at, updated_at, paid_at, recipient_address, recipient_username, recipient_user_id, recipient_email, burner_address, created_by, from_chain, from_token, to_chain, to_token, description, is_devnet, sender_tx_hash, legacy_claim_id, fee_paid_usdc, fee_on_sender, is_private")
    .eq("id", params.id)
    .maybeSingle();

  if (paymentRow) {
    rawPayment = normalisePayment(paymentRow as Record<string, unknown>);
  } else {
    // Fall back to legacy claims table
    const { data: claimRow, error: claimError } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, updated_at, paid_at, recipient_address, recipient_username, claim_burner_address, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description, is_devnet, sender_tx_hash")
      .eq("id", params.id)
      .maybeSingle();

    if (claimError || !claimRow) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    rawPayment = {
      ...claimRow as Record<string, unknown>,
      direction: "from_sender",
    };
    isLegacy = true;
  }

  const status = String((rawPayment?.status as string) || "").toUpperCase();
  if (status === "DELETED") {
    return NextResponse.json({ error: "This payment doesn't exist." }, { status: 404 });
  }

  const direction = String((rawPayment?.direction as string) || "from_sender");

  // from_recipient = payment request link created by the recipient — visible to anyone (payer doesn't need auth to view).
  // from_sender = private payment link — only creator or intended recipient may view.
  const isPublicPaymentRequest = direction === "from_recipient";

  const createdBy = String(rawPayment?.created_by ?? "");

  const requestingUserId = await getVerifiedUserId(request);

  if (!isPublicPaymentRequest) {
    // Authentication required for from_sender payments.
    if (!requestingUserId) {
      return NextResponse.json({ error: "Authentication required to view this payment." }, { status: 403 });
    }

    // Access control: only the creator or the intended recipient may view a claim.
    const recipientUserId = String((paymentRow as Record<string, unknown> | null)?.recipient_user_id ?? "");
    const isCreator = !!createdBy && createdBy === requestingUserId;
    const isKnownRecipient = !!recipientUserId && recipientUserId === requestingUserId;
    if (!isCreator && !isKnownRecipient) {
      // For PENDING_EMAIL/USERNAME claims the recipient_user_id is null (unregistered user).
      // Delegate identity check to the backend which has full Privy linked-account access.
      const ra = String(rawPayment?.recipient_address ?? "").trim();
      const isPendingIdentity = ra.startsWith(PENDING_EMAIL_PREFIX) || ra.startsWith(PENDING_USERNAME_PREFIX);
      if (isPendingIdentity) {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
        const authHeader = request.headers.get("authorization");
        const legacyId = request.headers.get("x-privy-user-id");
        try {
          const checkRes = await fetch(`${backendUrl}/claims/${params.id}/recipient-check`, {
            headers: {
              ...(authHeader ? { authorization: authHeader } : {}),
              ...(legacyId ? { "x-privy-user-id": legacyId } : {}),
            },
          });
          const checkData = checkRes.ok ? await checkRes.json().catch(() => ({})) : {};
          if (!checkData?.isRecipient) {
            return NextResponse.json({ error: "Payment not found." }, { status: 404 });
          }
          // isRecipient confirmed — fall through to return the claim
        } catch {
          return NextResponse.json({ error: "Payment not found." }, { status: 404 });
        }
      } else {
        return NextResponse.json({ error: "Payment not found." }, { status: 404 });
      }
    }
  }
  // from_recipient: public payment request — anyone can view, no access control needed

  // Run creator + recipient username lookups and intent fetch in parallel
  const creatorUsernamePromise = createdBy.includes('did:privy:')
    ? supabase.from("app_users").select("username").eq("privy_user_id", createdBy).maybeSingle()
    : Promise.resolve({ data: null });

  // recipient_username is only populated when the payment was created by resolving a
  // username/email — a payment sent by resolving a wallet address directly can still have a
  // known registered recipient_user_id with no recipient_username on the row. Resolve it the
  // same way creator_username is resolved, so the recipient's name still shows up.
  const recipientUserId = String((rawPayment as Record<string, unknown> | null)?.recipient_user_id ?? "");
  const recipientUsernamePromise = (!rawPayment?.recipient_username && recipientUserId.includes('did:privy:'))
    ? supabase.from("app_users").select("username").eq("privy_user_id", recipientUserId).maybeSingle()
    : Promise.resolve({ data: null });

  const intentPromise = isLegacy
    ? supabase.from("claim_intents").select("deposit_address, memo, deadline, time_estimate, quote_id, status, deposit_received_at").eq("claim_id", params.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : supabase.from("payment_intents").select("deposit_address, memo, deadline, time_estimate, quote_id, status").eq("payment_id", params.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const [{ data: appUser }, { data: recipientAppUser }, { data: intentData }] = await Promise.all([
    creatorUsernamePromise,
    recipientUsernamePromise,
    intentPromise,
  ]);

  const creator_username: string | null = (appUser as { username?: string } | null)?.username ?? null;
  const resolvedRecipientUsername: string | null = (recipientAppUser as { username?: string } | null)?.username ?? null;

  const claim: Record<string, unknown> = {
    ...rawPayment,
    creator_username: creator_username ?? null,
    recipient_username: (rawPayment?.recipient_username as string | null | undefined) ?? resolvedRecipientUsername ?? null,
  };

  // Mask recipient wallet — never expose the real address to the public
  const ra = String(rawPayment?.recipient_address ?? "").trim();
  const burner = String(
    isLegacy
      ? (rawPayment as Record<string, unknown>)?.claim_burner_address ?? ""
      : (rawPayment as Record<string, unknown>)?.burner_address ?? ""
  ).trim();

  if (ra.startsWith(PENDING_EMAIL_PREFIX)) {
    claim.recipient_address = undefined;
    claim.recipient_pending_email = true;
    claim.recipient_pending_email_value = ra.slice(PENDING_EMAIL_PREFIX.length).trim();
    if (burner) claim.claim_burner_address = burner;
  } else if (ra.startsWith(PENDING_USERNAME_PREFIX)) {
    claim.recipient_address = undefined;
    claim.recipient_pending_username = true;
    claim.recipient_pending_username_value = ra.slice(PENDING_USERNAME_PREFIX.length).trim();
    if (burner) claim.claim_burner_address = burner;
  } else if (ra) {
    claim.recipient_is_registered = true;
    if (burner) {
      claim.claim_burner_address = burner;
    }
    // Private links resolve the recipient server-side via the MagicBlock flow, so the real
    // address never needs to reach the browser. Non-private links build the transfer
    // client-side and genuinely need it — stripping it there left `recipient_address` (and
    // `getEffectiveRecipient()`) empty, which fed an empty string into `new PublicKey(...)`
    // downstream and threw "Invalid public key input" when paying.
    if ((rawPayment as Record<string, unknown> | null)?.is_private !== false) {
      delete claim.recipient_address;
    }
  } else {
    delete claim.recipient_address;
  }

  // Surface whether a recipient-edit is currently blocked by an in-flight claim — creator-only
  // (see recipient_claim_lock_at / claimAsRecipient in the backend), so the sender's "Edit
  // recipient" UI can disable itself instead of the edit call failing with no warning.
  // Fetched as its own best-effort query (never part of the main select above) — the
  // recipient_claim_lock_at column may not exist yet in every environment (migration
  // 20260713000000_payments_recipient_claim_lock.sql), and this flag is a nice-to-have, not
  // something the main payment lookup should ever fail over.
  const isCreatorForResponse = !isLegacy && !!createdBy && createdBy === requestingUserId;
  if (isCreatorForResponse) {
    try {
      const { data: lockRow } = await supabase
        .from("payments")
        .select("recipient_claim_lock_at")
        .eq("id", params.id)
        .maybeSingle();
      const lockAt = (lockRow as { recipient_claim_lock_at?: string | null } | null)?.recipient_claim_lock_at;
      claim.recipient_claim_in_progress = !!lockAt && Date.now() - new Date(lockAt).getTime() < RECIPIENT_CLAIM_LOCK_TTL_MS;
    } catch {
      // Column not migrated yet in this environment — feature just stays off.
    }
  }

  const intent = intentData as Record<string, unknown> | null;

  return NextResponse.json({
    claim,
    latestIntent: intent ? {
      depositAddress: intent.deposit_address || null,
      memo: intent.memo ?? null,
      deadline: intent.deadline || null,
      timeEstimate: typeof intent.time_estimate === "number" ? intent.time_estimate : null,
      quoteId: intent.quote_id || null,
      status: intent.status || null,
      depositReceivedAt: intent.deposit_received_at || null,
    } : null
  }, { status: 200 });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const paymentId = params.id;
  const verifiedId = await getVerifiedUserId(request);
  if (!verifiedId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId: string = verifiedId;
  console.log("[payments/PATCH] Updating payment:", paymentId, "verifiedUser:", userId);

  try {
    const body = await request.json();
    console.log("[payments/PATCH] Request body:", body);
    const { status: inputStatus, txHash, paidWith, paidWithChain, paidWithToken, depositReceivedAt, originAsset, destinationAsset } = body || {};

    const statusMap: Record<string, string> = {
      "PROCESSING": "IN_FLIGHT",
      "FAILED": "REFUNDED",
      "SUCCESS": "SUCCESS",
      "PENDING_DEPOSIT": "PENDING_DEPOSIT",
      "IN_FLIGHT": "IN_FLIGHT",
      "REFUNDED": "REFUNDED",
      "EXPIRED": "EXPIRED",
      "CANCELLED": "CANCELLED",
      "OPEN": "OPEN",
    };

    const status = statusMap[inputStatus?.toUpperCase()] || inputStatus;

    const allowedStatuses = ["OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "SUCCESS", "REFUNDED", "EXPIRED", "CANCELLED"];
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${inputStatus}. Allowed: ${allowedStatuses.join(", ")}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const updateData: Record<string, unknown> = { status };

    if (status === "SUCCESS") {
      updateData.paid_at = new Date().toISOString();
    }

    if (txHash) {
      updateData.sender_tx_hash = txHash;
    }

    // from_chain / from_token: prefer explicit paidWithChain/paidWithToken when provided;
    // fall back to regex-parsing paidWith for legacy callers.
    if (paidWithChain) {
      updateData.from_chain = String(paidWithChain).toLowerCase();
    } else if (paidWith) {
      const parenMatch = paidWith.match(/^([^(]+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        const token = parenMatch[1].trim().split(/\s+/)[0]; // first word is the token symbol
        const chain = parenMatch[2].trim().replace(/\s+wallet$/i, "").split(/\s+/)[0];
        updateData.from_chain = chain.toLowerCase();
        if (token) updateData.from_token = token.toUpperCase();
      } else {
        const onMatch = paidWith.match(/^([^on]+)\s+on\s+(.+)$/i);
        if (onMatch) {
          const token = onMatch[1].trim().split(/\s+/)[0];
          updateData.from_chain = onMatch[2].trim().toLowerCase();
          if (token) updateData.from_token = token.toUpperCase();
        }
      }
    }
    if (paidWithToken && !updateData.from_token) {
      updateData.from_token = String(paidWithToken).toUpperCase();
    }

    // Try payments table first
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, status, created_by, direction, sender_user_id, recipient_user_id")
      .eq("id", paymentId)
      .maybeSingle();

    let useLegacy = !existingPayment;

    if (!useLegacy) {
      const ep = existingPayment as { created_by?: string | null; direction?: string; sender_user_id?: string | null; recipient_user_id?: string | null };

      // Ownership check
      if (ep.direction === "from_recipient") {
        // Payment request link: any authenticated user may pay (sender_user_id is null).
        // Once a sender is assigned, only they or the creator may update further.
        if (ep.sender_user_id && ep.sender_user_id !== userId && ep.created_by !== userId) {
          return NextResponse.json({ error: "Not authorized to update this payment" }, { status: 403 });
        }
      } else {
        // from_sender: only creator/sender/recipient
        const isCreator   = !!ep.created_by && ep.created_by === userId;
        const isSender    = !!ep.sender_user_id && ep.sender_user_id === userId;
        const isRecipient = !!ep.recipient_user_id && ep.recipient_user_id === userId;
        if (!isCreator && !isSender && !isRecipient) {
          return NextResponse.json({ error: "Not authorized to update this payment" }, { status: 403 });
        }
      }

      // For CANCELLED: only the creator can cancel
      if (status === "CANCELLED") {
        if (ep.created_by && ep.created_by !== userId) {
          return NextResponse.json({ error: "Only the creator can cancel this payment" }, { status: 403 });
        }
      }

      if (status === "SUCCESS" && userId) {
        if (!ep.created_by) updateData.created_by = userId;
        // Set sender_user_id when payer completes a from_recipient request link
        if (ep.direction === "from_recipient" && !ep.sender_user_id) updateData.sender_user_id = userId;
        // Set sender_user_id for from_sender payments too if missing
        if (ep.direction !== "from_recipient" && !ep.sender_user_id) updateData.sender_user_id = userId;
      }

      const { data, error } = await supabase
        .from("payments")
        .update(updateData)
        .eq("id", paymentId)
        .select("id, status, created_at, paid_at")
        .single();

      if (error) {
        console.error("[payments/PATCH] Error updating payment:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Update payment_intents for routing analytics
      if (status === "IN_FLIGHT" || status === "SUCCESS" || status === "REFUNDED") {
        try {
          const intentUpdate: Record<string, unknown> = {
            status,
            updated_at: new Date().toISOString(),
          };

          if (status === "IN_FLIGHT" && (originAsset || destinationAsset)) {
            const { fromChain, toChain } = extractChainsFromAssets(originAsset, destinationAsset);
            const { data: existingIntent } = await supabase
              .from("payment_intents")
              .select("from_chain, to_chain")
              .eq("payment_id", paymentId)
              .maybeSingle();
            if (fromChain && !existingIntent?.from_chain) intentUpdate.from_chain = fromChain;
            if (toChain && !existingIntent?.to_chain) intentUpdate.to_chain = toChain;
          }

          await supabase
            .from("payment_intents")
            .update(intentUpdate)
            .eq("payment_id", paymentId);
        } catch (e) {
          console.error("[payments/PATCH] Error updating payment_intent:", e);
        }
      }

      if (status === 'SUCCESS' || status === 'PRIVATE_TRANSFER_PENDING') {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
        console.log(`[payments/PATCH] Triggering email notification for ${paymentId}`);
        fetch(`${backendUrl}/claims/${paymentId}/notify`, {
          method: 'POST',
          headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
        })
          .then(r => console.log(`[payments/PATCH] Notify response: ${r.status}`))
          .catch(e => console.error('[payments/PATCH] Notify call failed:', e));
      }

      return NextResponse.json({ ok: true, claim: data }, { status: 200 });
    }

    // Legacy: fall back to claims table
    const { data: existingClaim, error: checkError } = await supabase
      .from("claims")
      .select("id, status, created_by")
      .eq("id", paymentId)
      .maybeSingle();

    if (checkError || !existingClaim) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const legacyCreator = (existingClaim as { created_by?: string | null })?.created_by;
    if (legacyCreator && legacyCreator !== userId) {
      return NextResponse.json({ error: "Not authorized to update this payment" }, { status: 403 });
    }

    if (status === "SUCCESS" && userId && !(existingClaim as { created_by?: string | null }).created_by) {
      updateData.created_by = userId;
    }

    const legacyUpdate: Record<string, unknown> = { status };
    if (updateData.paid_at) legacyUpdate.paid_at = updateData.paid_at;
    if (updateData.sender_tx_hash) legacyUpdate.sender_tx_hash = updateData.sender_tx_hash;
    // Legacy claims table uses paid_with_chain/paid_with_token instead of from_chain/from_token
    if (updateData.from_chain) legacyUpdate.paid_with_chain = updateData.from_chain;
    if (updateData.created_by) legacyUpdate.created_by = updateData.created_by;

    const { data, error } = await supabase
      .from("claims")
      .update(legacyUpdate)
      .eq("id", paymentId)
      .select("id, status, created_at, paid_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (status === "IN_FLIGHT" || status === "SUCCESS" || status === "REFUNDED") {
      try {
        const intentUpdate: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
        };

        if (status === "IN_FLIGHT") {
          const { data: existingIntent } = await supabase
            .from("claim_intents")
            .select("deposit_received_at, from_chain, to_chain")
            .eq("claim_id", paymentId)
            .maybeSingle();

          if (existingIntent && !existingIntent.deposit_received_at) {
            intentUpdate.deposit_received_at = depositReceivedAt || new Date().toISOString();
          }

          if (originAsset || destinationAsset) {
            const { fromChain, toChain } = extractChainsFromAssets(originAsset, destinationAsset);
            if (fromChain && !existingIntent?.from_chain) intentUpdate.from_chain = fromChain;
            if (toChain && !existingIntent?.to_chain) intentUpdate.to_chain = toChain;
          }
        }

        await supabase
          .from("claim_intents")
          .update(intentUpdate)
          .eq("claim_id", paymentId);
      } catch (e) {
        console.error("[payments/PATCH] Error updating claim_intent:", e);
      }
    }

    return NextResponse.json({ ok: true, claim: data }, { status: 200 });
  } catch (e: any) {
    console.error("[payments/PATCH] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to update payment" }, { status: 500 });
  }
}

const DELETABLE_STATUSES = ["OPEN", "PENDING_DEPOSIT"];

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const paymentId = params.id;
  const userId = await getVerifiedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();

    // Try payments first
    const { data: payment } = await supabase
      .from("payments")
      .select("id, status, created_by")
      .eq("id", paymentId)
      .maybeSingle();

    if (payment) {
      const status = String((payment as { status?: string }).status || "").toUpperCase();
      const createdBy = (payment as { created_by?: string | null }).created_by;
      if (createdBy !== userId) {
        return NextResponse.json({ error: "Only the creator can delete this payment" }, { status: 403 });
      }
      if (!DELETABLE_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Only open or pending payments can be deleted" }, { status: 400 });
      }
      const { error } = await supabase
        .from("payments")
        .update({ status: "DELETED" })
        .eq("id", paymentId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Fall back to legacy claims
    const { data: claim, error: fetchError } = await supabase
      .from("claims")
      .select("id, status, created_by")
      .eq("id", paymentId)
      .maybeSingle();

    if (fetchError || !claim) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    const status = String((claim as { status?: string }).status || "").toUpperCase();
    const createdBy = (claim as { created_by?: string | null }).created_by;
    if (createdBy !== userId) {
      return NextResponse.json({ error: "Only the creator can delete this payment" }, { status: 403 });
    }
    if (!DELETABLE_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Only open or pending payments can be deleted" }, { status: 400 });
    }
    const { error: updateError } = await supabase
      .from("claims")
      .update({ status: "DELETED" })
      .eq("id", paymentId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to delete payment";
    console.error("[payments/DELETE]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
