'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { extractChainsFromAssets } from "@/lib/assetUtils";
import { getVerifiedSolanaWallets } from "@/lib/serverAuth";
import { verifySolanaUsdcPayment } from "@/lib/verifySolanaPayment";
import { getUsdcAtaBalanceBaseUnits } from "@/services/solanaBalance";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";
/** Must match ClaimsService.PENDING_SOCIAL_PREFIX (backend claims.service.ts). Format: PENDING_SOCIAL:<platform>:<handle> */
const PENDING_SOCIAL_PREFIX = "PENDING_SOCIAL:";
/** Must match ClaimsService.RECIPIENT_CLAIM_LOCK_TTL_MS (backend claims.service.ts). */
const RECIPIENT_CLAIM_LOCK_TTL_MS = 5 * 60_000;

// In-memory per-IP fixed-window limiter — same pattern as /api/share/[short_id]. Brute-forcing a
// 122-bit claim UUID is infeasible regardless, but this bounds request volume against any single
// known id (scraping, accidental retry storms) rather than leaving this endpoint fully open.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const params = await props.params;
  const supabase = getSupabaseAdmin();

  const { data: paymentRow } = await supabase
    .from("payments")
    .select("id, short_id, amount, direction, status, created_at, updated_at, paid_at, recipient_address, recipient_username, recipient_user_id, recipient_email, burner_address, created_by, from_chain, from_token, to_chain, to_token, description, is_devnet, sender_tx_hash, legacy_claim_id, fee_paid_usdc, fee_on_sender, is_private, claimed_privately, merchant_name, merchant_logo_url, sender_user_id, guest_sender_email")
    .eq("id", params.id)
    .maybeSingle();

  if (!paymentRow) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  const rawPayment: Record<string, unknown> = normalisePayment(paymentRow as Record<string, unknown>);

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

  // Lets a viewer who isn't (yet) confirmed as the recipient know *which* sign-in method or
  // platform this payment is pending on — without revealing the actual pending email/handle —
  // so the UI can prompt "sign in with Discord" / "connect your GitHub" instead of a dead end.
  function pendingLoginHint(ra: string): { pendingEmail: boolean; pendingSocialPlatform: string | null } | null {
    if (ra.startsWith(PENDING_EMAIL_PREFIX)) return { pendingEmail: true, pendingSocialPlatform: null };
    if (ra.startsWith(PENDING_SOCIAL_PREFIX)) {
      const rest = ra.slice(PENDING_SOCIAL_PREFIX.length);
      const sep = rest.indexOf(":");
      const platform = sep >= 0 ? rest.slice(0, sep).trim() : null;
      return { pendingEmail: false, pendingSocialPlatform: platform };
    }
    return null;
  }

  if (!isPublicPaymentRequest) {
    // Authentication required for from_sender payments.
    if (!requestingUserId) {
      const hint = pendingLoginHint(String(rawPayment?.recipient_address ?? "").trim());
      return NextResponse.json({ error: "Authentication required to view this payment.", ...hint }, { status: 403 });
    }

    // Access control: only the creator or the intended recipient may view a claim.
    const recipientUserId = String((paymentRow as Record<string, unknown> | null)?.recipient_user_id ?? "");
    const isCreator = !!createdBy && createdBy === requestingUserId;
    const isKnownRecipient = !!recipientUserId && recipientUserId === requestingUserId;
    if (!isCreator && !isKnownRecipient) {
      // For PENDING_EMAIL/USERNAME claims the recipient_user_id is null (unregistered user).
      // Delegate identity check to the backend which has full Privy linked-account access.
      const ra = String(rawPayment?.recipient_address ?? "").trim();
      const isPendingIdentity = ra.startsWith(PENDING_EMAIL_PREFIX) || ra.startsWith(PENDING_USERNAME_PREFIX) || ra.startsWith(PENDING_SOCIAL_PREFIX);
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
            return NextResponse.json({ error: "Payment not found.", ...pendingLoginHint(ra) }, { status: 404 });
          }
          // isRecipient confirmed — fall through to return the claim
        } catch {
          return NextResponse.json({ error: "Payment not found.", ...pendingLoginHint(ra) }, { status: 404 });
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

  // direction === "from_recipient" only: the payer's own username, when they have an account —
  // the "+$X.XX from Y" card (getSenderDisplay in c/[id]/page.tsx) needs this to show who actually
  // paid instead of falling back to the creator (the merchant/recipient, backwards for this
  // direction). guest_sender_email (added to rawPayment via the select above) covers the no-account
  // case for the same card.
  const senderUserId = String((rawPayment as Record<string, unknown> | null)?.sender_user_id ?? "");
  const senderUsernamePromise = senderUserId.includes('did:privy:')
    ? supabase.from("app_users").select("username").eq("privy_user_id", senderUserId).maybeSingle()
    : Promise.resolve({ data: null });

  const intentPromise = supabase.from("payment_intents").select("deposit_address, memo, deadline, time_estimate, quote_id, status").eq("payment_id", params.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const [{ data: appUser }, { data: recipientAppUser }, { data: senderAppUser }, { data: intentData }] = await Promise.all([
    creatorUsernamePromise,
    recipientUsernamePromise,
    senderUsernamePromise,
    intentPromise,
  ]);

  const creator_username: string | null = (appUser as { username?: string } | null)?.username ?? null;
  const resolvedRecipientUsername: string | null = (recipientAppUser as { username?: string } | null)?.username ?? null;
  const sender_username: string | null = (senderAppUser as { username?: string } | null)?.username ?? null;

  const claim: Record<string, unknown> = {
    ...rawPayment,
    creator_username: creator_username ?? null,
    recipient_username: (rawPayment?.recipient_username as string | null | undefined) ?? resolvedRecipientUsername ?? null,
    sender_username,
    // Raw Privy ID, only ever fetched above to resolve sender_username — this is a public,
    // no-auth-required endpoint for from_recipient links, so it must never reach the client.
    sender_user_id: undefined,
  };

  // Mask recipient wallet — never expose the real address to the public
  const ra = String(rawPayment?.recipient_address ?? "").trim();
  const burner = String((rawPayment as Record<string, unknown>)?.burner_address ?? "").trim();

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
  } else if (ra.startsWith(PENDING_SOCIAL_PREFIX)) {
    claim.recipient_address = undefined;
    claim.recipient_pending_social = true;
    const rest = ra.slice(PENDING_SOCIAL_PREFIX.length);
    const sep = rest.indexOf(":");
    claim.recipient_pending_social_platform = sep >= 0 ? rest.slice(0, sep).trim() : null;
    claim.recipient_pending_social_value = sep >= 0 ? rest.slice(sep + 1).trim() : rest.trim();
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
  const isCreatorForResponse = !!createdBy && createdBy === requestingUserId;
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

  try {
    const body = await request.json();
    if (process.env.NODE_ENV !== "production") {
      console.log("[payments/PATCH] Request body:", body);
    }
    const { status: inputStatus, txHash, paidWith, paidWithChain, paidWithToken, depositReceivedAt, originAsset, destinationAsset, guest_email: guestEmail } = body || {};

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
      "PRIVATE_TRANSFER_PENDING": "PRIVATE_TRANSFER_PENDING",
    };

    const status = statusMap[inputStatus?.toUpperCase()] || inputStatus;
    // Every burner-mediated payer-leg completion (guest checkout, private transfers) lands in the
    // claim's burner, not the recipient's real wallet — the recipient still has to claim/sweep it
    // out. PRIVATE_TRANSFER_PENDING is the existing status for exactly that "payer done, claim
    // pending" state (already used by the MagicBlock private-payment flow); GuestCheckoutPay now
    // sends it too instead of SUCCESS, so every code path below that used to gate on the payer's
    // leg completing (attribution, on-chain verification, paid_at) has to trigger on either value.
    const isPayerLegSettling = status === "SUCCESS" || status === "PRIVATE_TRANSFER_PENDING";

    // Guest checkout: no Privy session, only reachable for the one narrow case this route
    // already independently verifies below (first-time SUCCESS attribution on a from_recipient
    // link, gated on the burner's on-chain balance — see below) — every other transition (cancel,
    // edit, re-attribution, any non-SUCCESS status) still 401s with no session, same as before.
    //
    // guest_email is also the signal for "treat this as a guest payment" even when a Privy session
    // DOES exist — GuestCheckoutPay always sends it, deliberately, from its own confirmation call,
    // regardless of whether the browser happens to also be logged in. Without this, an already-
    // authenticated user completing a guest payment (their own email + a connected wallet, not
    // their Loofta balance) got silently attributed as having paid via their own account instead —
    // `isGuestAttempt` used to require *no* session at all, so `userId` below fell through to
    // `verifiedId` whenever one existed. Harmless for two different people, but when that logged-in
    // user is also the payment's own creator/recipient (a merchant testing their own checkout
    // link), sender_user_id ends up equal to recipient_user_id — a self-payment that trips the
    // self-issued-claim guard in SolanaSponsorService and strands the funds in the burner
    // (incident 2026-08-26, payment 1352b7e4-c2f3-4e31-9bca-45ff88acc151).
    const hasGuestEmail = typeof guestEmail === "string" && guestEmail.trim().length > 0;
    const isGuestAttempt = isPayerLegSettling && (!verifiedId || hasGuestEmail);
    if (!verifiedId && !isGuestAttempt) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isGuestAttempt) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (isRateLimited(ip)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
    }
    // A guest_email-flagged request never attributes to the caller's own session, even if one
    // exists — see isGuestAttempt above.
    const userId: string | null = hasGuestEmail ? null : verifiedId;
    if (process.env.NODE_ENV !== "production") {
      console.log("[payments/PATCH] Updating payment:", paymentId, "verifiedUser:", userId, "guest:", isGuestAttempt);
    }

    const allowedStatuses = ["OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "SUCCESS", "REFUNDED", "EXPIRED", "CANCELLED", "PRIVATE_TRANSFER_PENDING"];
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${inputStatus}. Allowed: ${allowedStatuses.join(", ")}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const updateData: Record<string, unknown> = { status };

    if (isPayerLegSettling) {
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

    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, status, created_by, direction, sender_user_id, recipient_user_id, amount, burner_address, is_devnet")
      .eq("id", paymentId)
      .maybeSingle();

    if (!existingPayment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    {
      const ep = existingPayment as {
        created_by?: string | null; direction?: string; sender_user_id?: string | null; recipient_user_id?: string | null;
        amount?: number | string | null; burner_address?: string | null; is_devnet?: boolean | null;
      };

      // Ownership check
      if (ep.direction === "from_recipient") {
        // Payment request link: any authenticated user may pay (sender_user_id is null).
        // Once a sender is assigned, only they or the creator may update further.
        if (ep.sender_user_id && ep.sender_user_id !== userId && ep.created_by !== userId) {
          return NextResponse.json({ error: "Not authorized to update this payment" }, { status: 403 });
        }

        // Every OTHER transition (REFUNDED, EXPIRED, IN_FLIGHT, OPEN, PENDING_DEPOSIT, CANCELLED)
        // is administrative, not a payment landing — only the creator may make it. The check above
        // is a no-op here for any guest-paid link: guest payments never set sender_user_id (only
        // guest_sender_email, see isGuestAttempt), so ep.sender_user_id stays null forever and that
        // condition never fires. Without this, any authenticated stranger with zero relationship to
        // this payment could reset someone else's live payment link's status — e.g. back to OPEN or
        // to EXPIRED — despite never having paid or created it.
        if (!isPayerLegSettling && ep.created_by && ep.created_by !== userId) {
          return NextResponse.json({ error: "Not authorized to update this payment" }, { status: 403 });
        }

        // First-time attribution ("who actually paid this request?") is the exploitable gap:
        // without this, any authenticated user could POST status:"SUCCESS" with a fabricated or
        // unrelated txHash and get themselves recorded as having paid someone else's request,
        // firing a false "you got paid" notification to the real creator. Once sender_user_id is
        // already set, later transitions are already ownership-gated above, so this only needs
        // to run on the transition that assigns it.
        if (isPayerLegSettling && !ep.sender_user_id) {
          if (!ep.burner_address) {
            return NextResponse.json({ error: "This payment has no verifiable destination yet — try again shortly." }, { status: 400 });
          }
          if (isGuestAttempt) {
            // No client-signed transaction to check a signature against here — a guest may have
            // paid via wallet-connect (their own signed tx) or a card onramp (Coinbase's own
            // internal transfer, never seen or signed by the browser at all), so this checks the
            // one thing true either way: does the burner actually hold the money now? The burner
            // address is unique per payment link, so a sufficient balance there can only mean
            // *this* link was funded — no signer/txHash needed to prove that.
            const balanceUnits = await getUsdcAtaBalanceBaseUnits(ep.burner_address, ep.is_devnet ? "devnet" : "mainnet");
            const requiredUnits = Math.round((Number(ep.amount) || 0) * 1_000_000);
            if (balanceUnits < requiredUnits) {
              return NextResponse.json({ error: "No payment has landed at this link's destination yet." }, { status: 400 });
            }
          } else {
            if (!txHash) {
              return NextResponse.json({ error: "A transaction signature is required to mark this as paid." }, { status: 400 });
            }
            const callerWallets = await getVerifiedSolanaWallets(userId as string);
            const verification = await verifySolanaUsdcPayment({
              txHash,
              destinationWallet: ep.burner_address,
              minAmountUsd: Number(ep.amount) || 0,
              callerWalletAddresses: callerWallets,
              isDevnet: !!ep.is_devnet,
            });
            if (!verification.valid) {
              console.warn(`[payments/PATCH] Rejected unverified SUCCESS claim on ${paymentId} by ${userId}: ${verification.reason}`);
              return NextResponse.json({ error: verification.reason || "Could not verify this payment on-chain." }, { status: 400 });
            }
          }
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

      if (isPayerLegSettling && userId) {
        if (!ep.created_by) updateData.created_by = userId;
        // Set sender_user_id when payer completes a from_recipient request link
        if (ep.direction === "from_recipient" && !ep.sender_user_id) updateData.sender_user_id = userId;
        // Set sender_user_id for from_sender payments too if missing
        if (ep.direction !== "from_recipient" && !ep.sender_user_id) updateData.sender_user_id = userId;
      } else if (isGuestAttempt) {
        // No Loofta account to attribute this to — mirrors the existing PENDING_EMAIL: pattern
        // already used for unregistered *recipients*, just for the sender side. If this email
        // later signs up for real, a future reconciliation pass could backfill sender_user_id,
        // same idea as the pendingAddresses matching in the payments/history route.
        if (typeof guestEmail === "string" && guestEmail.trim()) updateData.guest_sender_email = guestEmail.trim().toLowerCase();
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
      if (status === "IN_FLIGHT" || status === "SUCCESS" || status === "REFUNDED" || status === "PRIVATE_TRANSFER_PENDING") {
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

    const { data: payment } = await supabase
      .from("payments")
      .select("id, status, created_by")
      .eq("id", paymentId)
      .maybeSingle();

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to delete payment";
    console.error("[payments/DELETE]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
