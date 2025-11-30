 'use server'
 
 import { NextResponse } from "next/server";
 import { getSupabaseAdmin } from "@/lib/supabaseServer";
 
 export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("claim_intents")
      .select("deposit_address, memo, deadline, time_estimate, quote_id, status")
      .eq("claim_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }
    return NextResponse.json({
      depositAddress: data.deposit_address || null,
      memo: data.memo ?? null,
      deadline: data.deadline || null,
      timeEstimate: typeof data.time_estimate === "number" ? data.time_estimate : null,
      quoteId: data.quote_id || null,
      status: data.status || null,
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load latest intent" }, { status: 500 });
  }
 }
 

