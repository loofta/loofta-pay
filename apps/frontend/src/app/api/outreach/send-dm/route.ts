import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prospectId } = await req.json();
  if (!prospectId) return NextResponse.json({ error: "prospectId required" }, { status: 400 });

  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    return NextResponse.json({ error: "Twitter credentials not configured" }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: prospect } = await supabase
    .from("outreach_prospects")
    .select("*")
    .eq("id", prospectId)
    .single();

  if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  if (!["approved", "follow_pending"].includes(prospect.status)) {
    return NextResponse.json({ error: "Prospect must be approved before sending" }, { status: 400 });
  }

  const message = prospect.final_message ?? prospect.draft_message;
  if (!message) return NextResponse.json({ error: "No message to send" }, { status: 400 });

  // DMs require user context (OAuth 1.0a) — do NOT use appLogin()
  const client = new TwitterApi({
    appKey:       TWITTER_API_KEY,
    appSecret:    TWITTER_API_SECRET,
    accessToken:  TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });

  try {
    const target = await client.v2.userByUsername(prospect.handle);
    if (!target.data) {
      return NextResponse.json({ error: `@${prospect.handle} not found on X` }, { status: 404 });
    }
    const targetId = target.data.id;

    try {
      const dmResult = await client.v2.sendDmToParticipant(targetId, { text: message });
      console.log("[send-dm] result:", JSON.stringify(dmResult));

      const { data: updated } = await supabase
        .from("outreach_prospects")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "dm" })
        .eq("id", prospectId)
        .select("*")
        .single();

      return NextResponse.json(updated);
    } catch (dmErr: any) {
      const dmMsg: string = dmErr?.message ?? String(dmErr);
      const is403 = dmErr?.code === 403 || dmErr?.status === 403 || dmMsg.includes("403");

      if (!is403) throw dmErr; // surface non-403 errors normally

      // DMs restricted — follow them so they may DM back or accept our DM later
      console.log(`[send-dm] DMs restricted for @${prospect.handle}, falling back to follow`);
      try {
        const me = await client.v2.me();
        await client.v2.follow(me.data.id, targetId);
        console.log(`[send-dm] followed @${prospect.handle}`);
      } catch (followErr: any) {
        console.warn("[send-dm] follow failed:", followErr?.message);
      }

      const { data: updated } = await supabase
        .from("outreach_prospects")
        .update({ status: "follow_pending" })
        .eq("id", prospectId)
        .select("*")
        .single();

      return NextResponse.json({ ...updated, fallback: "followed" });
    }
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    console.error("[send-dm] error:", msg);

    if (err?.code === 429 || err?.status === 429 || msg.includes("429")) {
      return NextResponse.json({ error: "Rate limited — too many requests" }, { status: 429 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
