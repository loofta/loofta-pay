import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ mainnetAccess: false }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("mainnet_waitlist")
    .select("mainnet_access")
    .eq("privy_user_id", privyUserId)
    .eq("mainnet_access", true)
    .maybeSingle();

  return NextResponse.json({ mainnetAccess: !!data });
}
