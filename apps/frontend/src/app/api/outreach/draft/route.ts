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
    "This is a creator or influencer (YouTube, Twitter threads, newsletters, KOLs). They get paid for content, brand deals, collabs, and promos. Pain: sponsors pay late, payments are wired, their wallet history is exposed to brands.",
  freelancer:
    "This is a web3 freelancer or contractor (dev, designer, writer). They work for multiple clients, often across borders. Pain: invoicing is annoying, international payments are slow, crypto payments expose their entire wallet history.",
  web3_project:
    "This is a web3 project or protocol that pays contributors, bounty hunters, grantees, or remote team members in crypto. Pain: distributing payments to multiple contributors is messy, public on-chain history, different wallet formats. DEFAULT TO QUALIFYING unless there is strong evidence they are purely a trading bot, a scam, or completely dormant with zero activity.",
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

  return `You are an outreach agent for Loofta Pay.

PRODUCT:
${config.product_pitch}

TONE:
${config.message_tone}

CTA:
${config.call_to_action}

---
PROSPECT:
Handle: @${prospect.handle}
Current type hint: ${prospect.type}
Location: ${prospect.location || "(unknown)"}
Bio / signals: ${prospect.bio || "(no bio)"}

---
CONTEXT FOR THIS PROSPECT TYPE:
${TYPE_CONTEXT[prospect.type] ?? TYPE_CONTEXT.freelancer}

TYPE-SPECIFIC ANGLE:
${typePitch[prospect.type] ?? config.product_pitch}

---
YOUR TASK:

1. RECLASSIFY — Based on their bio and signals, confirm or correct the type.
   Choose exactly one: "creator" | "freelancer" | "web3_project"

2. QUALIFY — Is this person a realistic fit for Loofta Pay? Default to YES unless clearly not.
   Good fit: creates content for pay, does freelance work, runs a project with any kind of contributor or team payments.
   Only mark NOT qualified if: obvious trading/price bot, completely inactive account (no recent posts), or zero connection to getting paid or paying others.

3. DRAFT — If qualified, write a short outbound DM (2-3 sentences max).
   - Always open with exactly: "Hey, Lisa here, founder of @looftapay"
   - Personalize to their specific bio / recent activity
   - Use the type-specific angle above
   - Sound like a person, not a startup
   - Never use em dashes (—), never say "revolutionize", "seamless", "ecosystem", "leverage"
   - No hashtags, no emojis unless they clearly use them
   - End with the CTA

Respond ONLY with valid JSON, no markdown:
{
  "type": "creator"|"freelancer"|"web3_project",
  "qualified": true|false,
  "qualification_reason": "one sentence",
  "message": "draft DM text" | null
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
    // Strip em dashes regardless of prompt compliance
    if (parsed.message) parsed.message = parsed.message.replace(/—/g, "-").replace(/–/g, "-");

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
