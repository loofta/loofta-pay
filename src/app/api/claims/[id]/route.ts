'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address")
      .eq("id", params.id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ claim: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to fetch claim" }, { status: 500 });
  }
}

// Update claim status (for payment flow)
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const body = await request.json();
    const { status, txHash, paidWith } = body || {};
    
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
        // Use update instead of upsert to preserve existing deposit_address
        const { error: intentError } = await supabase
          .from("claim_intents")
          .update({
            status,
            tx_hash: txHash || null,
            paid_with: paidWith || null,
            updated_at: new Date().toISOString(),
          })
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


