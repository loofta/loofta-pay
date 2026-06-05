import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_prospects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[outreach/prospects] Supabase error:", error.message, error.code);
      // Table may not exist yet — return empty list so UI still loads
      return NextResponse.json({ prospects: [] });
    }
    return NextResponse.json({ prospects: data ?? [] });
  } catch (err) {
    console.error("[outreach/prospects] GET threw:", err);
    return NextResponse.json({ prospects: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { handle, bio, type } = await req.json();
    if (!handle?.trim()) {
      return NextResponse.json({ error: "handle is required" }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, "").trim().toLowerCase();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_prospects")
      .insert({ handle: cleanHandle, bio: bio ?? "", type: type ?? "individual" })
      .select("*")
      .single();
    if (error) {
      console.error("[outreach/prospects] POST insert error:", error.message, error.code);
      if (error.code === "23505") {
        return NextResponse.json({ error: `@${cleanHandle} is already in the queue` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[outreach/prospects] POST threw:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
