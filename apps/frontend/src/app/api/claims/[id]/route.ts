'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { extractChainsFromAssets } from "@/lib/assetUtils";

const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

/**
 * Verify the caller via the backend's /users/me endpoint (JWT or cached Privy lookup).
 * Returns the verified userId, or null if unauthenticated / verification fails.
 * Mirrors the same helper used in the payments/history route.
 */
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
      console.warn("[claims/PATCH] Backend JWT verify failed:", e);
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
      console.warn("[claims/PATCH] Backend legacy-ID verify failed:", e);
    }
    return null;
  }

  return null;
}

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = getSupabaseAdmin();
    
    const { data: rawClaim, error: claimError } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address, recipient_username, claim_burner_address, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description")
      .eq("id", params.id)
      .single();
    
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 404 });

    const claimStatus = String((rawClaim as { status?: string })?.status || "").toUpperCase();
    if (claimStatus === "DELETED") {
      return NextResponse.json({ error: "This payment doesn't exist." }, { status: 404 });
    }

    let creator_username: string | null = null;
    if (rawClaim?.created_by && typeof rawClaim.created_by === 'string' && rawClaim.created_by.includes('did:privy:')) {
      const { data: appUser } = await supabase
        .from("app_users")
        .select("username")
        .eq("privy_user_id", rawClaim.created_by)
        .maybeSingle();
      creator_username = appUser?.username ?? null;
    }
    
    // Mask pending claims like backend: expose recipient_pending_* and claim_burner_address so payers can pay to burner
    const ra = (rawClaim?.recipient_address ?? "").trim();
    const claim: Record<string, unknown> = {
      ...rawClaim,
      creator_username: creator_username ?? null,
    };
    if (ra.startsWith(PENDING_EMAIL_PREFIX)) {
      (claim as Record<string, unknown>).recipient_address = undefined;
      (claim as Record<string, unknown>).recipient_pending_email = true;
      // Ensure burner is always present for payers (explicit so it cannot be dropped)
      const burner = (rawClaim as { claim_burner_address?: string | null })?.claim_burner_address;
      if (burner) (claim as Record<string, unknown>).claim_burner_address = burner;
      console.log("[api/claims GET] Pending-email claim:", params.id, "claim_burner_address:", !!burner);
    } else if (ra.startsWith(PENDING_USERNAME_PREFIX)) {
      (claim as Record<string, unknown>).recipient_address = undefined;
      (claim as Record<string, unknown>).recipient_pending_username = true;
      (claim as Record<string, unknown>).recipient_pending_username_value = ra.slice(PENDING_USERNAME_PREFIX.length).trim();
      const burner = (rawClaim as { claim_burner_address?: string | null })?.claim_burner_address;
      if (burner) (claim as Record<string, unknown>).claim_burner_address = burner;
      console.log("[api/claims GET] Pending-username claim:", params.id, "claim_burner_address:", !!burner);
    }
    
    // Also get latest intent data (for hydration)
    const { data: intent } = await supabase
      .from("claim_intents")
      .select("deposit_address, memo, deadline, time_estimate, quote_id, status, deposit_received_at")
      .eq("claim_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to fetch claim" }, { status: 500 });
  }
}

// Update claim status (for payment flow)
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const claimId = params.id;
  // Verify identity via backend — never trust the raw header value
  const userId = await getVerifiedUserId(request) ?? undefined;
  console.log("[claims/PATCH] Updating claim:", claimId, "verifiedUser:", userId ?? "anonymous");
  
  try {
    const body = await request.json();
    console.log("[claims/PATCH] Request body:", body);
    const { status: inputStatus, txHash, paidWith, depositReceivedAt, originAsset, destinationAsset, isPrivate } = body || {};
    
    // Map legacy status names to database-valid values
    // Database constraint: 'OPEN', 'PENDING_DEPOSIT', 'IN_FLIGHT', 'SUCCESS', 'REFUNDED', 'EXPIRED', 'CANCELLED'
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
    
    // Validate status against database constraint
    const allowedStatuses = ["OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "SUCCESS", "REFUNDED", "EXPIRED", "CANCELLED"];
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${inputStatus}. Allowed: ${allowedStatuses.join(", ")}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    
    // Update claim status
    const updateData: Record<string, any> = { status };
    
    // Set is_private flag if provided (for private payments)
    if (isPrivate !== undefined) {
      updateData.is_private = isPrivate;
    }
    
    // Parse paidWith string to extract token and chain
    // Format examples: "USDC (Solana)", "USDC (Solana wallet)", "ETH on base", "USDC on sol"
    if (paidWith) {
      // Try to parse formats like "USDC (Solana)" or "USDC (Solana wallet)"
      const parenMatch = paidWith.match(/^([^(]+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        const token = parenMatch[1].trim();
        let chain = parenMatch[2].trim();
        // Remove "wallet" suffix if present
        chain = chain.replace(/\s+wallet$/i, "");
        updateData.paid_with_token = token;
        updateData.paid_with_chain = chain.toLowerCase();
      } else {
        // Try to parse formats like "USDC on sol" or "ETH on base"
        const onMatch = paidWith.match(/^([^on]+)\s+on\s+(.+)$/i);
        if (onMatch) {
          updateData.paid_with_token = onMatch[1].trim();
          updateData.paid_with_chain = onMatch[2].trim().toLowerCase();
        } else {
          // Fallback: try to extract token symbol (first word)
          const parts = paidWith.trim().split(/\s+/);
          if (parts.length > 0) {
            updateData.paid_with_token = parts[0];
            // Try to find chain in remaining parts
            const chainKeywords = ['solana', 'sol', 'base', 'arbitrum', 'arb', 'ethereum', 'eth', 'polygon', 'poly'];
            const foundChain = parts.find((p: string) => chainKeywords.includes(p.toLowerCase()));
            if (foundChain) {
              updateData.paid_with_chain = foundChain.toLowerCase();
            }
          }
        }
      }
    }
    
    // Set paid_at timestamp when status becomes SUCCESS
    if (status === "SUCCESS") {
      updateData.paid_at = new Date().toISOString();
      
      // Collect timing data for analytics
      // Get deposit_received_at from claim_intents
      const { data: intent } = await supabase
        .from("claim_intents")
        .select("deposit_received_at, from_chain, to_chain")
        .eq("claim_id", params.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (intent?.deposit_received_at) {
        // Calculate and store payment duration
        const depositTime = new Date(intent.deposit_received_at).getTime();
        const paidTime = new Date().getTime();
        const duration = Math.floor((paidTime - depositTime) / 1000);
        
        // Update claim_intents with duration
        await supabase
          .from("claim_intents")
          .update({ 
            payment_duration: duration,
            updated_at: new Date().toISOString(),
          })
          .eq("claim_id", params.id);
      }
    }
    
    // Fetch the existing claim to validate ownership and optionally backfill created_by
    console.log("[claims/PATCH] Checking if claim exists:", claimId);
    const { data: existingClaim, error: checkError } = await supabase
      .from("claims")
      .select("id, status, created_by")
      .eq("id", claimId)
      .maybeSingle();
    
    console.log("[claims/PATCH] Existing claim check:", { existingClaim, checkError });
    
    if (checkError) {
      console.error("[claims/PATCH] Error checking claim:", checkError);
      return NextResponse.json({ error: checkError.message }, { status: 500 });
    }

    // Ownership check: only the creator can cancel a payment
    if (status === "CANCELLED" && userId) {
      const claimCreator = (existingClaim as { created_by?: string | null } | null)?.created_by;
      if (claimCreator && claimCreator !== userId) {
        console.warn("[claims/PATCH] Unauthorized CANCELLED attempt:", { userId, claimCreator });
        return NextResponse.json({ error: "Only the creator can cancel this payment" }, { status: 403 });
      }
    }

    // When marking SUCCESS, backfill created_by if missing so the payment shows in history
    if (status === "SUCCESS" && userId && existingClaim && !(existingClaim as { created_by?: string | null }).created_by) {
      updateData.created_by = userId;
    }
    
    if (!existingClaim) {
      console.error("[claims/PATCH] Claim not found in database:", claimId);
      // Try to list all claims to debug
      const { data: allClaims } = await supabase
        .from("claims")
        .select("id")
        .limit(5);
      console.log("[claims/PATCH] Sample claim IDs:", allClaims);
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }
    
    console.log("[claims/PATCH] Claim exists, updating with:", updateData);
    // Update claim status
    const { data, error } = await supabase
      .from("claims")
      .update(updateData)
      .eq("id", claimId)
      .select("id, status, created_at, paid_at")
      .single();
    
    console.log("[claims/PATCH] Update result:", { data, error });
      
    if (error) {
      console.error("[claims/PATCH] Error updating claim:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (!data) {
      console.error("[claims/PATCH] No data returned after update:", params.id);
      return NextResponse.json({ error: "Failed to update claim" }, { status: 500 });
    }
    
    const updatedClaim = data;
    
    // Update claim_intent status (only update status-related fields, preserve deposit_address etc.)
    if (status === "IN_FLIGHT" || status === "SUCCESS" || status === "REFUNDED") {
      try {
        // Check if deposit_received_at should be set (first time status becomes IN_FLIGHT)
        let updateData: Record<string, any> = {
          status,
          tx_hash: txHash || null,
          paid_with: paidWith || null,
          updated_at: new Date().toISOString(),
        };
        
        // Set deposit_received_at when status first becomes IN_FLIGHT
        if (status === "IN_FLIGHT") {
          // Check if deposit_received_at is not already set
          const { data: existingIntent } = await supabase
            .from("claim_intents")
            .select("deposit_received_at, from_chain, to_chain")
            .eq("claim_id", params.id)
            .maybeSingle();
          
          if (existingIntent && !existingIntent.deposit_received_at) {
            // Use provided depositReceivedAt if available (from client), otherwise use current time
            updateData.deposit_received_at = depositReceivedAt || new Date().toISOString();
          }
          
          // Extract and store route information from asset IDs if not already stored
          if (originAsset || destinationAsset) {
            const { fromChain, toChain } = extractChainsFromAssets(originAsset, destinationAsset);
            
            // Only update if not already set
            if (fromChain && !existingIntent?.from_chain) {
              updateData.from_chain = fromChain;
            }
            if (toChain && !existingIntent?.to_chain) {
              updateData.to_chain = toChain;
            }
          }
        }
        
        // Use update instead of upsert to preserve existing deposit_address
        const { error: intentError } = await supabase
          .from("claim_intents")
          .update(updateData)
          .eq("claim_id", params.id);
        
        if (intentError) {
          console.error("[claims/PATCH] Error updating claim_intent:", intentError);
        }
      } catch (intentError) {
        // Non-critical, just log
        console.error("[claims/PATCH] Error updating claim_intent:", intentError);
      }
    }
    
    return NextResponse.json({ ok: true, claim: updatedClaim }, { status: 200 });
  } catch (e: any) {
    console.error("[claims/PATCH] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to update claim" }, { status: 500 });
  }
}

const DELETABLE_STATUSES = ["OPEN", "PENDING_DEPOSIT"];

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const claimId = params.id;
  const userId = request.headers.get("x-privy-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data: claim, error: fetchError } = await supabase
      .from("claims")
      .select("id, status, created_by")
      .eq("id", claimId)
      .maybeSingle();

    if (fetchError || !claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }
    const status = String((claim as { status?: string }).status || "").toUpperCase();
    const createdBy = (claim as { created_by?: string | null }).created_by;
    if (createdBy !== userId) {
      return NextResponse.json({ error: "Only the creator can delete this claim" }, { status: 403 });
    }
    if (!DELETABLE_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: "Only open or pending claims can be deleted" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("claims")
      .update({ status: "DELETED" })
      .eq("id", claimId);

    if (updateError) {
      console.error("[claims/DELETE] Update error:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to delete claim";
    console.error("[claims/DELETE]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
