import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ProspectType = "creator" | "freelancer" | "web3_project";

const TYPE_CONTEXT: Record<ProspectType, string> = {
  creator:
    "Creator or influencer (KOL, newsletter, YouTube, Twitter threads). Gets paid for content, brand deals, collabs, promos. Real pain: sponsors can look up their wallet address before negotiating rates - they see every inbound payment, every brand deal amount. They also get stuck converting tokens because brands always pay in whatever the brand holds. Loofta lets them receive in any token, privately - no wallet forensics possible. CTA: early access with perks - priority onboarding and direct support from Lisa. Close with something like: 'we're giving early users priority access - want in?' or 'spots are limited - want in?'",
  freelancer:
    "Web3 freelancer or contractor (dev, designer, writer, auditor). Works for multiple clients. Real pain: when a client pays them on-chain, the client can see every other project they've worked on, how much they earned, who else paid them - full income history exposed. With Loofta they get paid privately in any token their client holds, and withdraw to whatever they want. No awkward 'I only have ETH' moments.",
  web3_project:
    "Web3 protocol or project that pays contributors, grantees, bounty hunters, or a distributed team. Real pain: when they pay contributors from their treasury, every recipient can see the full payment list - who got what, how much the treasury has, who the other contributors are. Loofta decouples payments from treasury visibility. They can pay in any token they hold; contributors receive privately. DEFAULT TO QUALIFYING unless purely a trading bot, scam, or completely dormant.",
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
  },
) {
  const typePitch: Record<ProspectType, string> = {
    creator:       config.creator_pitch,
    freelancer:    config.freelancer_pitch,
    web3_project:  config.web3_project_pitch,
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

1. RECLASSIFY - confirm or correct: "creator" | "freelancer" | "web3_project"

2. QUALIFY - default YES. Only NO if: price/trading bot, completely dead account, zero connection to paying or being paid.

3. DRAFT - 2-3 sentences max. Rules:
   - Open with exactly: "Hey, Lisa here, founder of @looftapay"
   - Reference something specific from their bio or signal - don't be generic
   - Name the specific pain (wallet visibility, token friction, treasury exposure) - don't just name the solution
   - The "any token in, any token out" angle is underused - use it when relevant
   - For projects/teams: the scale angle works well - "streamline payments across your whole contributor base"
   - Do NOT say: "first protocol", "revolutionize", "seamless", "ecosystem", "leverage", "excited to", "love what you're doing", "want to try it"
   - Do NOT use em dashes or en dashes - use a comma or period instead. This is critical.
   - No hashtags, no emojis
   - CTA must be strong and specific: reference early user perks (priority onboarding + direct support from Lisa). End with a concrete yes/no question like "want in?" or "worth a chat?" - not "want to try it"

Respond ONLY with raw JSON (no markdown fences, no explanation):
{
  "type": "creator"|"freelancer"|"web3_project",
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
      model: "claude-sonnet-4-6",
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
    if (!["creator","freelancer","web3_project"].includes(parsed.type)) parsed.type = "creator";
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
    console.error("[outreach/draft] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
