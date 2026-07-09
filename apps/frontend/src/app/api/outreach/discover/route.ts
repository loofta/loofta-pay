import { NextRequest, NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

type ProspectType = "creator" | "freelancer" | "web3_project" | "giveaway_project";


// ─── Queries ──────────────────────────────────────────────────────────────────
// BD strategy: target people ALREADY doing crypto payments — proven behaviour.
// Web3 projects: look for VERIFIED PAYMENT ACTIVITY — grants distributed,
// bounties completed, contributors paid. Not just "we're hiring" noise.
// Rules: no min_faves/min_retweets (requires Elevated API), no emoji in queries.
const QUERIES: Array<{ q: string; hint: ProspectType }> = [

  // ── TIER 1: proven payment behaviour — highest BD signal ─────────────────
  { hint: "freelancer",   q: '"got paid" USDC -is:retweet lang:en' },
  { hint: "freelancer",   q: '"just got paid" crypto -is:retweet lang:en' },
  { hint: "web3_project", q: '"paid out" USDC -is:retweet lang:en' },
  { hint: "web3_project", q: '"sent USDC" contributors -is:retweet lang:en' },
  { hint: "web3_project", q: '"distributed" USDC grants -is:retweet lang:en' },

  // ── TIER 2: active grant / bounty programs — real treasury spend ──────────
  // These projects have recurring payment needs — exact fit for Loofta Pay
  { hint: "web3_project", q: '"grants round" solana -is:retweet lang:en' },
  { hint: "web3_project", q: '"bounty completed" solana -is:retweet lang:en' },
  { hint: "web3_project", q: '"grant recipients" crypto -is:retweet lang:en' },
  { hint: "web3_project", q: '"contributor rewards" solana -is:retweet lang:en' },
  { hint: "web3_project", q: '"superteam" earn "launched" -is:retweet lang:en' },
  { hint: "web3_project", q: '"gitcoin" round solana -is:retweet lang:en' },
  { hint: "web3_project", q: '"retroactive" funding solana -is:retweet lang:en' },

  // ── TIER 3: protocol teams actively paying remote contributors ────────────
  { hint: "web3_project", q: '"remote team" solana (hiring OR contributor) -is:retweet lang:en' },
  { hint: "web3_project", q: '"core contributor" solana -is:retweet lang:en' },
  { hint: "web3_project", q: '"our contributors" solana -is:retweet lang:en' },
  { hint: "web3_project", q: 'solana protocol "pay" contributor USDC -is:retweet lang:en' },
  { hint: "web3_project", q: '"treasury" solana "contributor" -is:retweet lang:en' },

  // ── CREATORS: active paid content & collabs ───────────────────────────────
  { hint: "creator", q: '"DM for collabs" (web3 OR crypto OR solana) -is:retweet lang:en' },
  { hint: "creator", q: '"paid promo" (crypto OR solana) -is:retweet lang:en' },
  { hint: "creator", q: '"paid partnership" crypto -is:retweet lang:en' },
  { hint: "creator", q: '"content creator" solana -is:retweet lang:en' },
  { hint: "creator", q: 'solana "ambassador" program apply -is:retweet lang:en' },

  // ── FREELANCERS: actively seeking or completing web3 work ─────────────────
  { hint: "freelancer", q: '"available for work" web3 -is:retweet lang:en' },
  { hint: "freelancer", q: '"open for freelance" crypto -is:retweet lang:en' },
  { hint: "freelancer", q: 'freelance solana (developer OR designer OR writer) -is:retweet lang:en' },
  { hint: "freelancer", q: '"superteam" earn completed -is:retweet lang:en' },
  { hint: "freelancer", q: '"received" USDC bounty -is:retweet lang:en' },

  // ── GIVEAWAY PROJECTS: currently running a giveaway / reward campaign ─────
  // BD strategy: co-market their giveaway + offer Loofta Pay as the winner payout
  // rail. Smaller/mid projects are the real fit here, not major CEXs who already
  // have their own payout infra.
  { hint: "giveaway_project", q: '"giveaway" "prize pool" crypto -is:retweet lang:en' },
  { hint: "giveaway_project", q: '"giveaway" winner solana -is:retweet lang:en' },
  { hint: "giveaway_project", q: '"reward campaign" crypto -is:retweet lang:en' },
  { hint: "giveaway_project", q: '"enter to win" (crypto OR solana OR web3) -is:retweet lang:en' },
  { hint: "giveaway_project", q: '"RT to enter" crypto -is:retweet lang:en' },
  { hint: "giveaway_project", q: '"winners will receive" crypto -is:retweet lang:en' },
];

function buildSignalText(bio: string, tweet: string, query: string): string {
  const parts: string[] = [];
  if (bio?.trim()) parts.push(bio.trim());
  parts.push(`signal: ${query}`);
  if (tweet?.trim() && tweet.length < 200) parts.push(`tweet: "${tweet.trim()}"`);
  return parts.join(" · ").slice(0, 500);
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    return NextResponse.json({ error: "Twitter credentials not configured" }, { status: 500 });
  }

  const debugLog: string[] = [];

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
      debugLog.push("auth: app-only Bearer token");
    } catch (e: any) {
      client = userClient.readOnly as unknown as TwitterApi;
      debugLog.push(`auth: user context fallback (${e?.message ?? "appLogin failed"})`);
    }

    const supabase = getSupabaseAdmin();
    const [{ data: existing }, { data: excluded }] = await Promise.all([
      supabase.from("outreach_prospects").select("handle"),
      supabase.from("outreach_excluded_handles").select("handle"),
    ]);
    const knownHandles = new Set([
      ...(existing ?? []).map((r: { handle: string }) => r.handle.toLowerCase()),
      ...(excluded ?? []).map((r: { handle: string }) => r.handle.toLowerCase()),
    ]);
    debugLog.push(`already in queue: ${(existing ?? []).length}, excluded: ${(excluded ?? []).length}`);

    const discovered: Array<{ handle: string; bio: string; hint_type: ProspectType; location: string | null; profile_image_url: string | null; followers_count: number | null }> = [];

    for (const { q, hint } of QUERIES) {
      try {
        const paginator = await client.v2.search(q, {
          max_results: 10,
          "tweet.fields": ["author_id", "text"],
          expansions: ["author_id"],
          "user.fields": ["username", "description", "public_metrics", "entities", "location", "profile_image_url"],
        });

        const tweets = paginator.tweets ?? [];
        const users  = paginator.includes?.users ?? [];

        debugLog.push(`[${hint}] "${q}": ${tweets.length} tweets, ${users.length} users`);

        for (const tweet of tweets) {
          const author = users.find((u) => u.id === tweet.author_id);
          if (!author) continue;

          const handle = author.username.toLowerCase();

          if (knownHandles.has(handle)) continue;
          if (handle === "looftapay") continue;

          // followers_count may not always come back — only skip obvious bots (0 followers AND no bio)
          const bio       = (author as any).description ?? "";
          const followers = (author as any).public_metrics?.followers_count;
          const avatar    = (author as any).profile_image_url as string | undefined;

          // Must have a profile picture and at least 100 followers
          if (!avatar || avatar.includes("default_profile")) continue;
          if ((followers ?? 0) < 100) continue;

          const location = (author as any).location?.trim() || null;
          const rawAvatar = (author as any).profile_image_url as string | undefined;
          const profile_image_url = rawAvatar
            ? rawAvatar.replace("_normal", "_400x400")
            : null;
          const followers_count = (author as any).public_metrics?.followers_count ?? null;

          knownHandles.add(handle);
          discovered.push({
            handle,
            bio: buildSignalText(bio, tweet.text, q),
            hint_type: hint,
            location,
            profile_image_url,
            followers_count,
          });
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        debugLog.push(`[${hint}] "${q}" FAILED: ${msg.slice(0, 120)}`);
        if (err?.code === 429 || err?.status === 429 || msg.includes("429")) {
          debugLog.push("rate limited — stopping");
          break;
        }
        // Any other error (400 invalid query, etc.) — skip this query and continue
      }
    }

    debugLog.push(`new prospects discovered: ${discovered.length}`);

    if (discovered.length === 0) {
      return NextResponse.json({ added: 0, message: "No new prospects found", debug: debugLog });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("outreach_prospects")
      .insert(discovered.map(({ handle, bio, hint_type, location, profile_image_url, followers_count }) => ({
        handle, bio, type: hint_type, status: "new", location, profile_image_url, followers_count,
      })))
      .select("*");

    if (insertError) {
      debugLog.push(`insert error: ${insertError.message}`);
      // Some may have hit the unique constraint — not a fatal error
    }

    return NextResponse.json({
      added:     inserted?.length ?? 0,
      prospects: inserted ?? [],
      debug:     debugLog,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[discover] fatal:", msg);
    return NextResponse.json({ error: msg, debug: debugLog }, { status: 500 });
  }
}
