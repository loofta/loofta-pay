'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isNonMainnetCluster } from "@/lib/solanaCluster";
import { generateShortId } from "@/lib/shortId";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function POST(request: Request) {
  const uid = await getVerifiedUserId(request);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { amount, toSel, recipient, description, direction, cluster, feeOnSender, isPrivate } = await request.json();
    if (!amount || !recipient) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const isFromRecipient = direction === 'from_recipient';
    const isDevnet = cluster === 'mainnet' ? false : cluster === 'devnet' ? true : isNonMainnetCluster();
    const shortId = generateShortId();
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
        is_devnet: isDevnet,
        description: description ? String(description).slice(0, 1000) : null,
        short_id: shortId,
        fee_on_sender: feeOnSender !== false,
        is_private: isPrivate !== false,
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const id = data?.id;
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "https://pay.loofta.xyz";
    const link = `${origin}/c/${shortId}`;
    return NextResponse.json({ id, short_id: shortId, link }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create payment" }, { status: 500 });
  }
}
