'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { extractChainsFromAssets } from "@/lib/assetUtils";

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = getSupabaseAdmin();
    
    const { data: claim, error: claimError } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description")
      .eq("id", params.id)
      .single();
    
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 404 });
    
    let creator_username: string | null = null;
    if (claim?.created_by && typeof claim.created_by === 'string' && claim.created_by.includes('did:privy:')) {
      const { data: appUser } = await supabase
        .from("app_users")
        .select("username")
        .eq("privy_user_id", claim.created_by)
        .maybeSingle();
      creator_username = appUser?.username ?? null;
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
      claim: {
        ...claim,
        creator_username: creator_username ?? null,
      },
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
  console.log("[claims/PATCH] Updating claim:", claimId);
  
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
    
    // First check if claim exists
    console.log("[claims/PATCH] Checking if claim exists:", claimId);
    const { data: existingClaim, error: checkError } = await supabase
      .from("claims")
      .select("id, status")
      .eq("id", claimId)
      .maybeSingle();
    
    console.log("[claims/PATCH] Existing claim check:", { existingClaim, checkError });
    
    if (checkError) {
      console.error("[claims/PATCH] Error checking claim:", checkError);
      return NextResponse.json({ error: checkError.message }, { status: 500 });
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


