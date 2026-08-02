import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "";

  let query = supabase
    .from("organizations")
    .select(
      "id, organization_id, name, logo_url, bg_color, checkout_status, org_referral, recipient_wallet, token_symbol, token_chain, contact_email, website_url, owner_privy_user_id, created_by, created_at"
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("checkout_status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ organizations: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, checkout_status } = body || {};
  if (!id || !checkout_status) {
    return NextResponse.json({ error: "id and checkout_status are required" }, { status: 400 });
  }
  if (!["active", "inactive", "pending"].includes(checkout_status)) {
    return NextResponse.json({ error: "Invalid checkout_status" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("organizations")
    .update({ checkout_status })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ organization: data });
}
