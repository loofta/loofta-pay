import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const MAGICBLOCK_API_KEY = process.env.MAGICBLOCK_QUEST_API_KEY;
const QUEST_ID = Number(process.env.MAGICBLOCK_QUEST_ID ?? "21");
const SPARKS_THRESHOLD = 3000;

function isValidBase58Pubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ validated: false }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("partner_quest_validations")
    .select("wallet, validated_at")
    .eq("user_id", privyUserId)
    .eq("quest_id", QUEST_ID)
    .maybeSingle();

  if (data) {
    return NextResponse.json({ validated: true, wallet: data.wallet, validatedAt: data.validated_at });
  }
  return NextResponse.json({ validated: false });
}

export async function POST(request: NextRequest) {
  if (!MAGICBLOCK_API_KEY) {
    return NextResponse.json({ error: "Quest validation not configured" }, { status: 503 });
  }

  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return early if already validated
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("partner_quest_validations")
    .select("wallet")
    .eq("user_id", privyUserId)
    .eq("quest_id", QUEST_ID)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ alreadyCompleted: true, wallet: existing.wallet });
  }

  let walletPubkey: string;
  try {
    const body = await request.json();
    walletPubkey = (body.wallet ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isValidBase58Pubkey(walletPubkey)) {
    return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }

  // Verify the user has reached the threshold on our backend
  const authHeader = request.headers.get("authorization") ?? "";
  const sparksRes = await fetch(
    `${BACKEND_URL}/rewards/me?network=mainnet`,
    { headers: { Authorization: authHeader } },
  );
  if (!sparksRes.ok) {
    return NextResponse.json({ error: "Could not verify sparks balance" }, { status: 502 });
  }
  const sparksData = await sparksRes.json();
  if ((sparksData.totalSparks ?? 0) < SPARKS_THRESHOLD) {
    return NextResponse.json(
      { error: `You need at least ${SPARKS_THRESHOLD} Sparks to validate this quest` },
      { status: 403 },
    );
  }

  // Push validation to MagicBlock
  let mbRes: Response;
  try {
    mbRes = await fetch("https://quests.magicblock.app/api/validators/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MAGICBLOCK_API_KEY}`,
      },
      body: JSON.stringify({
        payload: {
          quest: QUEST_ID,
          user: walletPubkey,
          timestamp: Date.now(),
        },
      }),
    });
  } catch {
    return NextResponse.json({ error: "MagicBlock API unreachable" }, { status: 502 });
  }

  const mbData = await mbRes.json().catch(() => ({}));
  if (!mbRes.ok) {
    return NextResponse.json(
      { error: mbData?.message ?? "MagicBlock validation failed", detail: mbData },
      { status: mbRes.status },
    );
  }

  // Persist permanently in Supabase
  await supabase.from("partner_quest_validations").upsert({
    user_id: privyUserId,
    quest_id: QUEST_ID,
    wallet: walletPubkey,
  });

  return NextResponse.json({ ...mbData, completed: true });
}
