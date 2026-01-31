'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  try {
    const { amount, toSel, recipient, userId } = await request.json();
    if (!amount || !toSel?.symbol || !toSel?.chain || !recipient) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("claims")
      .insert({
        amount: String(amount),
        to_symbol: String(toSel.symbol),
        to_chain: String(toSel.chain),
        recipient_address: String(recipient),
        created_by: userId ? String(userId) : null,
        creator_email: null,
        status: "OPEN",
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const id = data?.id;
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.xyz";
    const link = `${origin}/c/${id}`;
    return NextResponse.json({ id, link }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create claim" }, { status: 500 });
  }
}


