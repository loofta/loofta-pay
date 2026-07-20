import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { redisSet } from "@/lib/redis-cache";

const TOKEN_TTL_SECONDS = 5 * 60;

function relayTokenKey(token: string) {
  return `telegram-relay:${token}`;
}

/**
 * Mint a short-lived, single-use token that lets the loofta.com Telegram relay page identify
 * which Loofta account to attach a Telegram handle to, without exposing the Privy user ID or
 * requiring a second Privy login on that domain (see telegram-relay/page.tsx + callback route).
 * POST /api/users/telegram-relay-token
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = randomBytes(24).toString("hex");
  await redisSet(relayTokenKey(token), privyUserId, TOKEN_TTL_SECONDS);
  return NextResponse.json({ token, expiresInSeconds: TOKEN_TTL_SECONDS });
}
