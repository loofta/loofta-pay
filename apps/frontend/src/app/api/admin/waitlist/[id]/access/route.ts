import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { grant } = await request.json() as { grant: boolean };
  if (typeof grant !== "boolean") {
    return NextResponse.json({ error: "grant must be a boolean" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("mainnet_waitlist")
    .update({ mainnet_access: grant })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
