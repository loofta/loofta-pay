'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isNonMainnetCluster } from "@/lib/solanaCluster";

export async function POST(request: Request) {
  try {
    const { amount, toSel, recipient, userId, description, direction } = await request.json();
    if (!amount || !recipient) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const isFromRecipient = direction === 'from_recipient';
    const uid = userId ? String(userId) : null;
    const { data, error } = await supabase
      .from("payments")
      .insert({
        amount: Number(amount),
        direction: isFromRecipient ? 'from_recipient' : 'from_sender',
        recipient_address: String(recipient),
        created_by: uid,
        sender_user_id: isFromRecipient ? null : uid,
        recipient_user_id: isFromRecipient ? uid : null,
        status: "OPEN",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        to_chain: "solana",
        to_token: "USDC",
        is_devnet: isNonMainnetCluster(),
        description: description ? String(description).slice(0, 1000) : null,
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
    return NextResponse.json({ error: e?.message || "Failed to create payment" }, { status: 500 });
  }
}
