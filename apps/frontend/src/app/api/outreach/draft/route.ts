import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[outreach/draft] ANTHROPIC_API_KEY is not set — all draft requests will fail");
} 
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ProspectType = "creator" | "freelancer" | "web3_project" | "giveaway_project" | "creator_platform";

const TYPE_CONTEXT: Record<ProspectType, string> = {
  creator:
    "Creator or influencer (KOL, newsletter, YouTube, Twitter threads). Gets paid for content, brand deals, collabs, promos. Real pain: sponsors can look up their wallet address before negotiating rates - they see every inbound payment, every brand deal amount. They also get stuck converting tokens because brands always pay in whatever the brand holds. Loofta lets them receive in any token, privately - no wallet forensics possible. CTA: early access with perks - priority onboarding and direct support from Lisa. Close with something like: 'we're giving early users priority access - want in?' or 'spots are limited - want in?'",
  freelancer:
    "Web3 freelancer or contractor (dev, designer, writer, auditor). Works for multiple clients. Real pain: when a client pays them on-chain, the client can see every other project they've worked on, how much they earned, who else paid them - full income history exposed. With Loofta they get paid privately in any token their client holds, and withdraw to whatever they want. No awkward 'I only have ETH' moments.",
  web3_project:
    "Web3 protocol or project that pays contributors, grantees, bounty hunters, or a distributed team. Real pain: when they pay contributors from their treasury, every recipient can see the full payment list - who got what, how much the treasury has, who the other contributors are. Loofta decouples payments from treasury visibility. They can pay in any token they hold; contributors receive privately. DEFAULT TO QUALIFYING unless purely a trading bot, scam, or completely dormant.",
  giveaway_project:
    "A crypto project, community, or account currently running (or about to run) a giveaway, reward campaign, or contest with a prize pool. This is NOT the treasury-privacy pitch - it's a partnership pitch. Real pain: winners are usually picked manually and asked to drop a wallet address in replies or DMs - slow, and easy to accuse of being rigged. Loofta's angle: draw winners with verifiable onchain randomness (VRF, anyone can check it wasn't rigged), and winners claim with just their email or X handle, no crypto wallet required. DEFAULT TO QUALIFYING if there's a live or recent giveaway/reward campaign signal.",
  creator_platform:
    "A platform or agency that runs creator, clipping, or KOL campaigns and pays many creators per campaign (pay-per-view clipping marketplaces, KOL marketplaces, UGC platforms). Partnership pitch, not treasury privacy. Real pain: paying hundreds of small creators across many countries is slow and costly, PayPal is blocked or expensive in places like Nigeria, Pakistan and the Philippines, and wallet-only payouts lose creators who have no wallet. Loofta angle: they pay with a link, the creator claims with just an email or X handle, and can cash out to a wallet or local bank (Naira works today). DEFAULT TO QUALIFYING unless the account is clearly dead.",
};

function buildPrompt(
  prospect: { handle: string; bio: string; type: ProspectType; location?: string },
  config: {
    product_pitch: string;
    message_tone: string;
    call_to_action: string;
    creator_pitch: string;
    freelancer_pitch: string;
    web3_project_pitch: string;
    giveaway_project_pitch: string;
    creator_platform_pitch: string;
  },
) {
  const typePitch: Record<ProspectType, string> = {
    creator:           config.creator_pitch,
    freelancer:        config.freelancer_pitch,
    web3_project:      config.web3_project_pitch,
    giveaway_project:  config.giveaway_project_pitch,
    creator_platform:  config.creator_platform_pitch,
  };

  return `You are writing outbound DMs for Lisa, founder of Loofta Pay.

WHAT LOOFTA ACTUALLY IS:
${config.product_pitch}

KEY DIFFERENTIATORS (work these in naturally, not as a list):
- Pay or get paid in ANY token - no forced USDC conversion
- Recipients withdraw in whatever token they want
- Payments are private on-chain - no one can trace the amount, sender, or link it to a wallet's history
- Works on Solana, any wallet

TONE: ${config.message_tone}

CTA: ${config.call_to_action}

---
PROSPECT:
Handle: @${prospect.handle}
Type hint: ${prospect.type}
Location: ${prospect.location || "(unknown)"}
Bio / signals: ${prospect.bio || "(no bio)"}

---
WHAT THIS TYPE OF PERSON ACTUALLY CARES ABOUT:
${TYPE_CONTEXT[prospect.type] ?? TYPE_CONTEXT.freelancer}

SPECIFIC ANGLE TO USE:
${typePitch[prospect.type] ?? config.product_pitch}

---
TASK:

1. RECLASSIFY - confirm or correct: "creator" | "freelancer" | "web3_project" | "giveaway_project" | "creator_platform"

2. QUALIFY - default YES. Only NO if: price/trading bot, completely dead account, zero connection to paying or being paid (or, for giveaway_project, zero signal of a live/recent giveaway or reward campaign).

3. DRAFT - 2-3 sentences max. Rules:
   - Open with exactly: "Hey, Lisa here from Loofta Pay."
   - Keep it simple and conversational - do not try to reference their specific bio or seem over-researched
   - Ask a qualifying question first ("is that your case?" style) before pitching
   - For creator/freelancer/web3_project: focus on the simple value prop: pay teammates privately, just using their email, they claim however they want. Do NOT lead with the pain angle or treasury exposure - keep it friendly and low-pressure.
   - For giveaway_project: ask if their giveaway/campaign is still live, then pitch the VRF-verifiable draw and no-wallet-needed claim (email or X handle). If the SPECIFIC ANGLE TO USE contains a URL, invite them to try it (soft, not an instruction - "if you want to try it out, you can create one here: [URL]") and let them know once they do, you'll waive the fee.
   - Do NOT say: "first protocol", "revolutionize", "seamless", "ecosystem", "leverage", "excited to", "love what you're doing", "want to try it", "co-market", "co-marketing", "promote it to our audience", "more eyes on the campaign"
   - Do NOT use em dashes or en dashes - use a comma or period instead. This is critical.
   - No hashtags, no emojis
   - End with a warm, open invite: "would love to have you in" or "worth a chat?"

Respond ONLY with raw JSON (no markdown fences, no explanation):
{
  "type": "creator"|"freelancer"|"web3_project"|"giveaway_project",
  "qualified": true|false,
  "qualification_reason": "one sentence",
  "message": "draft DM text or null if not qualified"
}`;
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prospectId, config } = await req.json();
  if (!prospectId) return NextResponse.json({ error: "prospectId required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  const { data: prospect, error: fetchErr } = await supabase
    .from("outreach_prospects")
    .select("*")
    .eq("id", prospectId)
    .single();

  if (fetchErr || !prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  await supabase.from("outreach_prospects").update({ status: "drafting" }).eq("id", prospectId);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: buildPrompt(prospect, config) }],
    });

    const rawText = (response.content[0] as { type: string; text: string }).text.trim();
    // Strip markdown code fences if Claude wraps the JSON
    const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as {
      type: string;
      qualified: boolean;
      qualification_reason: string;
      message: string | null;
    };
    // Normalize any stale "KOL" value Claude might still return
    if (parsed.type === "KOL") parsed.type = "creator";
    if (!["creator","freelancer","web3_project","giveaway_project","creator_platform"].includes(parsed.type)) parsed.type = "creator";
    // Strip all dash variants and curly quotes regardless of prompt compliance
    if (parsed.message) {
      parsed.message = parsed.message
        .replace(/—/g, ",")   // em dash → comma
        .replace(/–/g, "-")   // en dash → hyphen
        .replace(/‒/g, "-")   // figure dash → hyphen
        .replace(/―/g, "-")   // horizontal bar → hyphen
        .replace(/[‘’]/g, "'")  // curly single quotes → straight
        .replace(/[“”]/g, '"'); // curly double quotes → straight
    }

    const { data: updated, error: updateErr } = await supabase
      .from("outreach_prospects")
      .update({
        status:                "drafted",
        type:                  parsed.type,
        qualified:             parsed.qualified,
        qualification_reason:  parsed.qualification_reason,
        draft_message:         parsed.message ?? null,
      })
      .eq("id", prospectId)
      .select("*")
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    return NextResponse.json(updated);
  } catch (err: any) {
    await supabase.from("outreach_prospects").update({ status: "new" }).eq("id", prospectId);
    const msg = err?.message ?? String(err);
    const status = err?.status ?? 500;
    const isAuthError = status === 401 || msg.includes("authentication_error") || msg.includes("invalid x-api-key");
    if (isAuthError) {
      const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 20) ?? "(not set)";
      console.error("[outreach/draft] Anthropic auth failed — key prefix in use:", keyPrefix + "...");
      console.error("[outreach/draft] Full error:", msg);
      return NextResponse.json({ error: "Anthropic API key is invalid. Update ANTHROPIC_API_KEY in env and restart." }, { status: 500 });
    }
    console.error("[outreach/draft] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
