'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { extractChainsFromAssets } from "@/lib/assetUtils";

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = getSupabaseAdmin();
    
    // Get claim data
    const { data: claim, error: claimError } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address")
      .eq("id", params.id)
      .single();
    
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 404 });
    
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
  try {
    const body = await request.json();
    const { status, txHash, paidWith, depositReceivedAt, originAsset, destinationAsset } = body || {};
    
    // Validate status
    const allowedStatuses = ["PROCESSING", "SUCCESS", "FAILED", "PENDING_DEPOSIT"];
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    
    // Update claim status
    const updateData: Record<string, any> = { status };
    
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
    
    const { data, error } = await supabase
      .from("claims")
      .update(updateData)
      .eq("id", params.id)
      .select("id, status, created_at, paid_at")
      .single();
      
    if (error) {
      console.error("[claims/PATCH] Error updating claim:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Update claim_intent status (only update status-related fields, preserve deposit_address etc.)
    if (status === "PROCESSING" || status === "SUCCESS" || status === "FAILED") {
      try {
        // Check if deposit_received_at should be set (first time status becomes PROCESSING)
        let updateData: Record<string, any> = {
          status,
          tx_hash: txHash || null,
          paid_with: paidWith || null,
          updated_at: new Date().toISOString(),
        };
        
        // Set deposit_received_at when status first becomes PROCESSING
        if (status === "PROCESSING") {
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
    
    return NextResponse.json({ ok: true, claim: data }, { status: 200 });
  } catch (e: any) {
    console.error("[claims/PATCH] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to update claim" }, { status: 500 });
  }
}


