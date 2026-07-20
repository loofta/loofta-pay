import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

/**
 * Returns the authenticated user's connected social_accounts handles. Discord/GitHub are also
 * readable directly from Privy's linkedAccounts client-side, but Telegram only lives here (it's
 * connected via the loofta.com widget relay, not a Privy OAuth link — see telegram-relay/).
 * GET /api/users/social-handles
 */
export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("platform, handle")
    .eq("user_id", privyUserId);

  if (error) {
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }

  const handles: Record<string, string> = {};
  for (const row of data || []) {
    handles[row.platform as string] = row.handle as string;
  }
  return NextResponse.json({ handles });
}
