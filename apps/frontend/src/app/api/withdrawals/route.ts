import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

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
    } catch {}
  }
  return null;
}

export async function GET(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const isDevnet = searchParams.get("devnet") === "true";

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("user_id", userId)
      .eq("is_devnet", isDevnet)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ withdrawals: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const record = {
      user_id:              userId,
      amount_usdc:          body.amountUSDC,
      tx_signature:         body.txSignature,
      destination_address:  body.destinationAddress,
      destination_chain:    body.destinationChain,
      destination_token:    body.destinationToken,
      is_near_intents:      body.isNearIntents ?? false,
      deposit_address:      body.depositAddress ?? null,
      estimated_out:        body.estimatedOut ?? null,
      quote_id:             body.quoteId ?? null,
      near_intents_status:  body.nearIntentsStatus ?? null,
      near_intents_complete: body.nearIntentsComplete ?? false,
      is_devnet:            body.isDevnet ?? false,
      ...(body.sourceToken ? { source_token: String(body.sourceToken) } : {}),
      ...(body.sourceAmount != null ? { source_amount: Number(body.sourceAmount) } : {}),
    };

    // The id is the Solana tx signature. It used to be update-only, which silently saved nothing
    // for a new swap (no row existed yet). Upsert, but never let one user overwrite another's row.
    const id = String(body.id || body.txSignature || "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const { data: existing } = await supabase.from("withdrawals").select("user_id").eq("id", id).maybeSingle();
    if (existing && existing.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { error } = await supabase.from("withdrawals").upsert({ id, ...record }, { onConflict: "id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, nearIntentsStatus, nearIntentsComplete } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("withdrawals")
      .update({ near_intents_status: nearIntentsStatus, near_intents_complete: nearIntentsComplete })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
