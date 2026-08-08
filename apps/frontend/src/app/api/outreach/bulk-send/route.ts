import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

// POST — start a bulk send job, or resume the one already running.
// Sending itself does NOT happen here: this only freezes the ordered list of
// prospects to send to and a cursor. The client drives progress one send at a
// time via /api/outreach/bulk-send/next, so nothing depends on a background
// process surviving between requests (see /next/route.ts for why).
export async function POST(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("outreach_bulk_jobs")
    .select("*")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ jobId: existing.id, total: existing.total, resumed: true });
  }

  const { data: prospects } = await supabase
    .from("outreach_prospects")
    .select("id")
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  if (!prospects?.length) {
    return NextResponse.json({ error: "No approved prospects to send" }, { status: 400 });
  }

  const { data: job, error } = await supabase
    .from("outreach_bulk_jobs")
    .insert({
      total: prospects.length,
      sent: 0,
      status: "running",
      prospect_ids: prospects.map((p: { id: string }) => p.id),
      next_index: 0,
    })
    .select("*")
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? "Failed to create job" }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id, total: job.total });
}

// GET — return latest job status
export async function GET(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("outreach_bulk_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(job ?? null);
}

// DELETE — force-stop any running job (e.g. an orphaned one from a dead client tab)
export async function DELETE(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("outreach_bulk_jobs")
    .update({ status: "stopped", error: "Manually stopped", finished_at: new Date().toISOString(), current_handle: null })
    .eq("status", "running");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
