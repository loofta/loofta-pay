import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const DEFAULT_CONFIG = {
  product_pitch:        "Loofta Pay — private payments on Solana. Get paid and pay others without exposing your whole wallet history.",
  message_tone:         "casual, crypto-native, low-pressure, peer-to-peer (not salesy)",
  call_to_action:       "ask if they'd want early access",
  creator_pitch:        "Get paid for your content and collabs in USDC instantly, with no wallet history exposed to brands.",
  freelancer_pitch:     "Get paid across borders in USDC instantly. No bank account required, no fees, no wallet history.",
  web3_project_pitch:   "Hey, Lisa here from Loofta Pay. I'm reaching out to a few projects that pay their team in crypto - is that your case? We're offering free access to our platform to pay your teammates privately, just using their email address. They claim it however they want. Would love to have you in.",
  giveaway_project_pitch: "Hey, Lisa here from Loofta Pay. Saw your giveaway - noticed winners get picked manually and have to drop wallet addresses in replies or DMs. We built a tool that draws winners with verifiable onchain randomness (VRF, anyone can check it wasn't rigged), and they claim with just their email or X handle, no wallet needed, so normies can enter too. If you want to try it out, you can create one here: https://pay.loofta.xyz/rewards/giveaways/create. Let me know once you do, I'll waive the fee for you :)",
  creator_platform_pitch: "Hey, Lisa here from Loofta Pay. Saw you pay creators and clippers per campaign. We built payout links: you send the payment, they claim it with just their email or X handle, and they can cash out to a wallet or their local bank (Naira works today), no wallet setup needed on their side. Free to try and I'll waive the fee for you. Worth a chat?",
};

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_config")
      .select("product_pitch, message_tone, call_to_action, creator_pitch, freelancer_pitch, web3_project_pitch, giveaway_project_pitch, creator_platform_pitch, updated_at")
      .eq("id", 1)
      .single();
    if (error) {
      console.error("[outreach/config] Supabase error:", error.message, error.code);
      return NextResponse.json(DEFAULT_CONFIG);
    }
    return NextResponse.json({ ...DEFAULT_CONFIG, ...data });
  } catch (err) {
    console.error("[outreach/config] GET threw:", err);
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_config")
      .upsert({ id: 1, ...body, updated_at: new Date().toISOString() })
      .select("product_pitch, message_tone, call_to_action, creator_pitch, freelancer_pitch, web3_project_pitch, giveaway_project_pitch, creator_platform_pitch, updated_at")
      .single();
    if (error) {
      console.error("[outreach/config] POST upsert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[outreach/config] POST threw:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
