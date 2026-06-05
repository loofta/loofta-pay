import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

const LOOFTA_HANDLE = "looftapay";

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    return NextResponse.json({ error: "Twitter credentials not configured" }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const debug: string[] = [];

  try {
    const userClient = new TwitterApi({
      appKey:       TWITTER_API_KEY,
      appSecret:    TWITTER_API_SECRET,
      accessToken:  TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_SECRET,
    });

    let client: TwitterApi;
    try {
      client = await userClient.appLogin();
      debug.push("auth: app-only Bearer token");
    } catch (e: any) {
      client = userClient.readOnly as unknown as TwitterApi;
      debug.push(`auth: user context fallback (${e?.message})`);
    }

    // Fetch sent prospects (engagement tracking) + follow_pending (followback detection)
    const { data: sentProspects } = await supabase
      .from("outreach_prospects")
      .select("id, handle, status")
      .eq("status", "sent")
      .or("replied.eq.false,followed.eq.false");

    const { data: followPending } = await supabase
      .from("outreach_prospects")
      .select("id, handle")
      .eq("status", "follow_pending");

    const sentHandles      = new Set((sentProspects ?? []).map((p: { handle: string }) => p.handle.toLowerCase()));
    const pendingHandles   = new Set((followPending ?? []).map((p: { handle: string }) => p.handle.toLowerCase()));
    const allWatchHandles  = new Set([...sentHandles, ...pendingHandles]);

    if (!allWatchHandles.size) {
      return NextResponse.json({ replied: 0, followed: 0, readyToDm: 0, message: "Nothing to check", debug });
    }

    debug.push(`sent: ${sentHandles.size}, follow_pending: ${pendingHandles.size}`);

    // ── 1. Check for replies/mentions of @looftapay ───────────────────────────
    const repliedHandles = new Set<string>();
    try {
      const mentions = await client.v2.search(`@${LOOFTA_HANDLE} -is:retweet lang:en`, {
        max_results: 100,
        "tweet.fields": ["author_id"],
        expansions: ["author_id"],
        "user.fields": ["username"],
      });
      for (const user of mentions.includes?.users ?? []) {
        const h = user.username.toLowerCase();
        if (sentHandles.has(h)) repliedHandles.add(h);
      }
      debug.push(`mentions scan: ${mentions.tweets?.length ?? 0} tweets, ${repliedHandles.size} matches`);
    } catch (err: any) {
      debug.push(`mentions scan failed: ${err?.message?.slice(0, 100)}`);
    }

    // ── 2. Check followers of @looftapay (engagement + followback detection) ──
    const followedHandles   = new Set<string>(); // for sent engagement
    const followedBackHandles = new Set<string>(); // for follow_pending → ready to DM
    try {
      const looftaUser = await client.v2.userByUsername(LOOFTA_HANDLE, { "user.fields": ["id"] });
      const looftaId = looftaUser.data.id;

      const followers = await client.v2.followers(looftaId, {
        max_results: 1000,
        "user.fields": ["username"],
      });
      for (const user of followers.data ?? []) {
        const h = user.username.toLowerCase();
        if (sentHandles.has(h))   followedHandles.add(h);
        if (pendingHandles.has(h)) followedBackHandles.add(h);
      }
      debug.push(`followers scan: ${followers.data?.length ?? 0} checked, ${followedHandles.size} sent matches, ${followedBackHandles.size} followback matches`);
    } catch (err: any) {
      debug.push(`followers scan failed: ${err?.message?.slice(0, 100)}`);
    }

    // ── 3. Update sent prospects (engagement flags) ───────────────────────────
    let repliedCount = 0;
    let followedCount = 0;

    for (const prospect of sentProspects ?? []) {
      const h = prospect.handle.toLowerCase();
      const update: Record<string, boolean> = {};
      if (repliedHandles.has(h))  { update.replied  = true; repliedCount++; }
      if (followedHandles.has(h)) { update.followed = true; followedCount++; }
      if (Object.keys(update).length) {
        await supabase.from("outreach_prospects").update(update).eq("id", prospect.id);
      }
    }

    // ── 4. Promote follow_pending → approved when they followed back ──────────
    let readyToDm = 0;
    for (const prospect of followPending ?? []) {
      const h = prospect.handle.toLowerCase();
      if (followedBackHandles.has(h)) {
        await supabase
          .from("outreach_prospects")
          .update({ status: "approved" })
          .eq("id", prospect.id);
        readyToDm++;
      }
    }

    debug.push(`updated: ${repliedCount} replied, ${followedCount} followed, ${readyToDm} ready to DM`);

    return NextResponse.json({ replied: repliedCount, followed: followedCount, readyToDm, debug });
  } catch (err: any) {
    console.error("[check-engagement] fatal:", err?.message);
    return NextResponse.json({ error: err?.message ?? "Unknown error", debug }, { status: 500 });
  }
}
