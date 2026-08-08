import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

// Sends exactly one DM for the given job's next prospect and advances the job's
// cursor, then returns. The client calls this in a loop with a delay in between —
// see bulk-send/route.ts for why nothing here runs as a server background loop.
export async function POST(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  const { data: job } = await supabase.from("outreach_bulk_jobs").select("*").eq("id", jobId).single();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "running") return NextResponse.json({ job, done: true });

  const prospectIds: string[] = job.prospect_ids ?? [];
  if (job.next_index >= prospectIds.length) {
    const { data: updated } = await supabase
      .from("outreach_bulk_jobs")
      .update({ status: "done", current_handle: null, finished_at: new Date().toISOString() })
      .eq("id", jobId)
      .select("*")
      .single();
    return NextResponse.json({ job: updated, done: true });
  }

  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    const { data: updated } = await supabase
      .from("outreach_bulk_jobs")
      .update({ status: "stopped", error: "Twitter credentials not configured", finished_at: new Date().toISOString() })
      .eq("id", jobId)
      .select("*")
      .single();
    return NextResponse.json({ job: updated, done: true });
  }

  const prospectId = prospectIds[job.next_index];
  const nextIndex = job.next_index + 1;

  const { data: prospect } = await supabase.from("outreach_prospects").select("*").eq("id", prospectId).single();

  // Prospect vanished, got rejected, or has no message since the job started — skip it,
  // the cursor still advances so we never get stuck retrying the same slot.
  if (!prospect || !["approved", "follow_pending"].includes(prospect.status)) {
    const { data: updated } = await supabase
      .from("outreach_bulk_jobs")
      .update({ next_index: nextIndex, current_handle: null })
      .eq("id", jobId)
      .select("*")
      .single();
    return NextResponse.json({ job: updated, done: false, skipped: true, handle: prospect?.handle ?? null });
  }

  const message = prospect.final_message ?? prospect.draft_message;
  if (!message) {
    const { data: updated } = await supabase
      .from("outreach_bulk_jobs")
      .update({ next_index: nextIndex, current_handle: null })
      .eq("id", jobId)
      .select("*")
      .single();
    return NextResponse.json({ job: updated, done: false, skipped: true, handle: prospect.handle });
  }

  await supabase.from("outreach_bulk_jobs").update({ current_handle: prospect.handle }).eq("id", jobId);

  const client = new TwitterApi({
    appKey:       TWITTER_API_KEY,
    appSecret:    TWITTER_API_SECRET,
    accessToken:  TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });

  try {
    const target = await client.v2.userByUsername(prospect.handle);
    if (!target.data) {
      const { data: updated } = await supabase
        .from("outreach_bulk_jobs")
        .update({ next_index: nextIndex, current_handle: null })
        .eq("id", jobId)
        .select("*")
        .single();
      return NextResponse.json({ job: updated, done: false, skipped: true, handle: prospect.handle, reason: "not found on X" });
    }

    try {
      await client.v2.sendDmToParticipant(target.data.id, { text: message });
      await supabase
        .from("outreach_prospects")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })
        .eq("id", prospect.id);

      const { data: updated } = await supabase
        .from("outreach_bulk_jobs")
        .update({ next_index: nextIndex, sent: job.sent + 1, current_handle: null })
        .eq("id", jobId)
        .select("*")
        .single();
      return NextResponse.json({ job: updated, done: false, result: "sent", handle: prospect.handle });
    } catch (dmErr: any) {
      const msg = String(dmErr?.message ?? dmErr);
      const is403 = dmErr?.code === 403 || dmErr?.status === 403 || msg.includes("403");
      const is429 = dmErr?.code === 429 || dmErr?.status === 429 || msg.includes("429");

      if (is429) {
        const { data: updated } = await supabase
          .from("outreach_bulk_jobs")
          .update({ status: "stopped", error: "Rate limited by X", current_handle: null, finished_at: new Date().toISOString() })
          .eq("id", jobId)
          .select("*")
          .single();
        return NextResponse.json({ job: updated, done: true, rateLimited: true });
      }

      if (is403) {
        const me = await client.v2.me();
        await client.v2.follow(me.data.id, target.data.id).catch(() => {});
        await supabase.from("outreach_prospects").update({ status: "follow_pending" }).eq("id", prospect.id);
        const { data: updated } = await supabase
          .from("outreach_bulk_jobs")
          .update({ next_index: nextIndex, current_handle: null })
          .eq("id", jobId)
          .select("*")
          .single();
        return NextResponse.json({ job: updated, done: false, result: "follow_pending", handle: prospect.handle });
      }

      // Unexpected error — advance past it rather than retry-looping on the same prospect forever.
      console.error(`[bulk-send/next] DM error for @${prospect.handle}:`, msg);
      const { data: updated } = await supabase
        .from("outreach_bulk_jobs")
        .update({ next_index: nextIndex, current_handle: null })
        .eq("id", jobId)
        .select("*")
        .single();
      return NextResponse.json({ job: updated, done: false, result: "error", handle: prospect.handle, error: msg });
    }
  } catch (err: any) {
    console.error(`[bulk-send/next] outer error for @${prospect.handle}:`, err?.message);
    const { data: updated } = await supabase
      .from("outreach_bulk_jobs")
      .update({ next_index: nextIndex, current_handle: null })
      .eq("id", jobId)
      .select("*")
      .single();
    return NextResponse.json({ job: updated, done: false, result: "error", handle: prospect.handle, error: err?.message });
  }
}
