import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

// Mainnet access rarely changes — cache per user for 5 minutes
const cache = new Map<string, { access: boolean; exp: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ mainnetAccess: false }, { status: 401 });
  }

  const hit = cache.get(privyUserId);
  if (hit && Date.now() < hit.exp) {
    return NextResponse.json({ mainnetAccess: hit.access });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("mainnet_waitlist")
    .select("mainnet_access")
    .eq("privy_user_id", privyUserId)
    .eq("mainnet_access", true)
    .maybeSingle();

  const access = !!data;
  cache.set(privyUserId, { access, exp: Date.now() + TTL_MS });

  return NextResponse.json({ mainnetAccess: access });
}
