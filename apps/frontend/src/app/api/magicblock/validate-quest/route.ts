import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const MAGICBLOCK_API_KEY = process.env.MAGICBLOCK_QUEST_API_KEY;
const QUEST_ID = Number(process.env.MAGICBLOCK_QUEST_ID ?? "21");
const SPARKS_THRESHOLD = 3000;

// Basic base58 check (non-empty, valid chars, plausible length)
function isValidBase58Pubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export async function POST(request: NextRequest) {
  if (!MAGICBLOCK_API_KEY) {
    return NextResponse.json({ error: "Quest validation not configured" }, { status: 503 });
  }

  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const payload = {
    quest: QUEST_ID,
    user: walletPubkey,
    timestamp: Date.now(),
  };

  let mbRes: Response;
  try {
    mbRes = await fetch("https://api.magicblock.xyz/api/validators/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MAGICBLOCK_API_KEY}`,
      },
      body: JSON.stringify({ payload }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "MagicBlock API unreachable" }, { status: 502 });
  }

  const mbData = await mbRes.json().catch(() => ({}));
  if (!mbRes.ok) {
    return NextResponse.json(
      { error: mbData?.message ?? "MagicBlock validation failed", detail: mbData },
      { status: mbRes.status },
    );
  }

  return NextResponse.json(mbData);
}
