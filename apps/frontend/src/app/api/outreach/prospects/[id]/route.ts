import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const allowed = ["status", "final_message", "draft_message", "qualified", "qualification_reason", "sent_at", "sent_via"];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("outreach_prospects")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  // Fetch the handle first so we can permanently exclude it
  const { data: prospect } = await supabase
    .from("outreach_prospects")
    .select("handle")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("outreach_prospects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Block this handle from re-appearing in future discovery runs
  if (prospect?.handle) {
    await supabase
      .from("outreach_excluded_handles")
      .upsert({ handle: prospect.handle.toLowerCase() }, { onConflict: "handle" });
  }

  return NextResponse.json({ ok: true });
}
