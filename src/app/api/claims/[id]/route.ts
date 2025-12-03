'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, status, created_at, recipient_address")
      .eq("id", params.id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ claim: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to fetch claim" }, { status: 500 });
  }
}


