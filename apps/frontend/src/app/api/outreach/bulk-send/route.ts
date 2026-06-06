import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const DELAY_MS = 45_000;

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

async function runBulkSend(jobId: string, prospectIds: string[]) {
  const supabase = getSupabaseAdmin();
  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;

  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    await supabase
      .from("outreach_bulk_jobs")
      .update({ status: "stopped", error: "Twitter credentials not configured", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return;
  }

  const client = new TwitterApi({
    appKey:       TWITTER_API_KEY,
    appSecret:    TWITTER_API_SECRET,
    accessToken:  TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });

  let sent = 0;

  for (let i = 0; i < prospectIds.length; i++) {
    const { data: prospect } = await supabase
      .from("outreach_prospects")
      .select("*")
      .eq("id", prospectIds[i])
      .single();

    if (!prospect || !["approved", "follow_pending"].includes(prospect.status)) continue;

    const message = prospect.final_message ?? prospect.draft_message;
    if (!message) continue;

    await supabase
      .from("outreach_bulk_jobs")
      .update({ current_handle: prospect.handle })
      .eq("id", jobId);

    try {
      const target = await client.v2.userByUsername(prospect.handle);
      if (!target.data) continue;

      try {
        await client.v2.sendDmToParticipant(target.data.id, { text: message });
        await supabase
          .from("outreach_prospects")
          .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })
          .eq("id", prospect.id);
        sent++;
      } catch (dmErr: any) {
        const msg = String(dmErr?.message ?? dmErr);
        const is403 = dmErr?.code === 403 || dmErr?.status === 403 || msg.includes("403");
        const is429 = dmErr?.code === 429 || dmErr?.status === 429 || msg.includes("429");

        if (is429) {
          await supabase
            .from("outreach_bulk_jobs")
            .update({ status: "stopped", error: "Rate limited by X", sent, current_handle: null, finished_at: new Date().toISOString() })
            .eq("id", jobId);
          return;
        }

        if (is403) {
          const me = await client.v2.me();
          await client.v2.follow(me.data.id, target.data.id).catch(() => {});
          await supabase
            .from("outreach_prospects")
            .update({ status: "follow_pending" })
            .eq("id", prospect.id);
        }
      }
    } catch (err: any) {
      console.error(`[bulk-send] error for @${prospect.handle}:`, err?.message);
    }

    await supabase
      .from("outreach_bulk_jobs")
      .update({ sent })
      .eq("id", jobId);

    if (i < prospectIds.length - 1) {
      await supabase
        .from("outreach_bulk_jobs")
        .update({ current_handle: null })
        .eq("id", jobId);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  await supabase
    .from("outreach_bulk_jobs")
    .update({ status: "done", sent, current_handle: null, finished_at: new Date().toISOString() })
    .eq("id", jobId);
}

// POST — start a bulk send job
export async function POST(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();

  // Check if a job is already running
  const { data: existing } = await supabase
    .from("outreach_bulk_jobs")
    .select("id, status")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "A bulk send is already in progress", jobId: existing.id }, { status: 409 });
  }

  const { data: prospects } = await supabase
    .from("outreach_prospects")
    .select("id")
    .eq("status", "approved");

  if (!prospects?.length) {
    return NextResponse.json({ error: "No approved prospects to send" }, { status: 400 });
  }

  const { data: job } = await supabase
    .from("outreach_bulk_jobs")
    .insert({ total: prospects.length, sent: 0, status: "running" })
    .select("*")
    .single();

  if (!job) return NextResponse.json({ error: "Failed to create job" }, { status: 500 });

  // Fire and forget — response is sent immediately
  runBulkSend(job.id, prospects.map((p: { id: string }) => p.id)).catch((err) => {
    console.error("[bulk-send] unhandled:", err?.message);
    getSupabaseAdmin()
      .from("outreach_bulk_jobs")
      .update({ status: "stopped", error: err?.message, finished_at: new Date().toISOString() })
      .eq("id", job.id);
  });

  return NextResponse.json({ jobId: job.id, total: prospects.length });
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
