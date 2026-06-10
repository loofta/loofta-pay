import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const randomDelayMs = () => Math.floor(Math.random() * (60_000 - 15_000 + 1)) + 15_000;

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
  console.log(`[bulk-send] job ${jobId} starting — ${prospectIds.length} prospect(s)`);

  for (let i = 0; i < prospectIds.length; i++) {
    const { data: prospect } = await supabase
      .from("outreach_prospects")
      .select("*")
      .eq("id", prospectIds[i])
      .single();

    if (!prospect) { console.log(`[bulk-send] [${i+1}/${prospectIds.length}] prospect ${prospectIds[i]} not found — skipping`); continue; }
    if (!["approved", "follow_pending"].includes(prospect.status)) {
      console.log(`[bulk-send] [${i+1}/${prospectIds.length}] @${prospect.handle} status="${prospect.status}" — skipping`);
      continue;
    }

    const message = prospect.final_message ?? prospect.draft_message;
    if (!message) { console.log(`[bulk-send] [${i+1}/${prospectIds.length}] @${prospect.handle} has no message — skipping`); continue; }

    console.log(`[bulk-send] [${i+1}/${prospectIds.length}] sending to @${prospect.handle}…`);

    await supabase
      .from("outreach_bulk_jobs")
      .update({ current_handle: prospect.handle })
      .eq("id", jobId);

    try {
      const target = await client.v2.userByUsername(prospect.handle);
      if (!target.data) { console.log(`[bulk-send] @${prospect.handle} not found on X — skipping`); continue; }
      console.log(`[bulk-send] resolved @${prospect.handle} → id ${target.data.id}`);

      try {
        const dmResult = await client.v2.sendDmToParticipant(target.data.id, { text: message });
        console.log(`[bulk-send] ✓ DM sent to @${prospect.handle}`, JSON.stringify(dmResult));
        await supabase
          .from("outreach_prospects")
          .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })
          .eq("id", prospect.id);
        sent++;
      } catch (dmErr: any) {
        const msg = String(dmErr?.message ?? dmErr);
        const is403 = dmErr?.code === 403 || dmErr?.status === 403 || msg.includes("403");
        const is429 = dmErr?.code === 429 || dmErr?.status === 429 || msg.includes("429");
        console.error(`[bulk-send] DM error for @${prospect.handle} — code=${dmErr?.code ?? dmErr?.status} msg=${msg}`);

        if (is429) {
          console.error(`[bulk-send] rate limited — stopping job`);
          await supabase
            .from("outreach_bulk_jobs")
            .update({ status: "stopped", error: "Rate limited by X", sent, current_handle: null, finished_at: new Date().toISOString() })
            .eq("id", jobId);
          return;
        }

        if (is403) {
          console.log(`[bulk-send] DMs restricted for @${prospect.handle} — following instead`);
          const me = await client.v2.me();
          await client.v2.follow(me.data.id, target.data.id).catch((e: any) => console.warn(`[bulk-send] follow failed:`, e?.message));
          await supabase
            .from("outreach_prospects")
            .update({ status: "follow_pending" })
            .eq("id", prospect.id);
        }
      }
    } catch (err: any) {
      console.error(`[bulk-send] outer error for @${prospect.handle}:`, err?.message, err?.code ?? err?.status);
    }

    await supabase
      .from("outreach_bulk_jobs")
      .update({ sent })
      .eq("id", jobId);

    if (i < prospectIds.length - 1) {
      const delay = randomDelayMs();
      console.log(`[bulk-send] waiting ${Math.round(delay / 1000)}s before next DM…`);
      await supabase
        .from("outreach_bulk_jobs")
        .update({ current_handle: null })
        .eq("id", jobId);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.log(`[bulk-send] job ${jobId} done — ${sent} sent`);
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

// DELETE — force-stop any running job (clears stale jobs after server restart)
export async function DELETE(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("outreach_bulk_jobs")
    .update({ status: "stopped", error: "Manually stopped", finished_at: new Date().toISOString(), current_handle: null })
    .eq("status", "running");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  console.log("[bulk-send] job manually stopped");
  return NextResponse.json({ ok: true });
}
