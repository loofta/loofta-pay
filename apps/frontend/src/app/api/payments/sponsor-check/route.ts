/**
 * Privy gas-sponsorship rate-limit gate.
 * Called before every { sponsor: true } Solana send.
 *
 * Implements the three-tier spending cap pattern from:
 * https://docs.privy.io/recipes/gas-sponsorship-rate-limits
 *
 * Tiers (all daily, UTC midnight reset):
 *   perWallet : $2   – prevents single-wallet ATA-rent drain loops
 *   perUser   : $5   – caps aggregate across all of one user's wallets
 *   perApp    : $50  – hard ceiling for the whole platform
 *
 * Cost estimate: $0.50 per sponsored Solana tx (worst-case ATA rent ~$0.40 + fee).
 * Normal txs without ATA creation cost ~$0.01, so the wallet cap allows ~200 legitimate sends/day.
 */

import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";

// ─── Config ──────────────────────────────────────────────────────────────────

const LIMITS = {
  perWalletDailyCents: 200,  // $2 / wallet / day
  perUserDailyCents:   500,  // $5 / user  / day
  perAppDailyCents:   5000,  // $50 / app  / day
};

// Solana worst-case: ATA rent + tx fee ≈ $0.50
const SOLANA_COST_CENTS = 50;

// ─── In-process spend tracking ────────────────────────────────────────────────
// Resets on deploy/restart. Each Next.js server process maintains its own Map.
// For a distributed / serverless fleet, swap for Redis (Upstash) or Supabase.

type DailyBucket = { date: string; cents: number };

const walletSpend = new Map<string, DailyBucket>();
const userSpend   = new Map<string, DailyBucket>();
let   appSpend: DailyBucket = { date: "", cents: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getBucket(map: Map<string, DailyBucket>, key: string): DailyBucket {
  const today = todayUTC();
  const existing = map.get(key);
  if (existing && existing.date === today) return existing;
  const fresh: DailyBucket = { date: today, cents: 0 };
  map.set(key, fresh);
  return fresh;
}

function getAppBucket(): DailyBucket {
  const today = todayUTC();
  if (appSpend.date !== today) appSpend = { date: today, cents: 0 };
  return appSpend;
}

function canSponsor(walletAddress: string, userId: string): { allowed: boolean; reason?: string } {
  const walletBucket = getBucket(walletSpend, walletAddress);
  if (walletBucket.cents + SOLANA_COST_CENTS > LIMITS.perWalletDailyCents) {
    return { allowed: false, reason: `Daily send limit reached for this wallet ($${LIMITS.perWalletDailyCents / 100}). Try again tomorrow.` };
  }

  const userBucket = getBucket(userSpend, userId);
  if (userBucket.cents + SOLANA_COST_CENTS > LIMITS.perUserDailyCents) {
    return { allowed: false, reason: `Daily send limit reached for this account ($${LIMITS.perUserDailyCents / 100}). Try again tomorrow.` };
  }

  const appBucket = getAppBucket();
  if (appBucket.cents + SOLANA_COST_CENTS > LIMITS.perAppDailyCents) {
    return { allowed: false, reason: "Platform send limit reached. Please try again later." };
  }

  return { allowed: true };
}

function recordSpend(walletAddress: string, userId: string) {
  getBucket(walletSpend, walletAddress).cents += SOLANA_COST_CENTS;
  getBucket(userSpend, userId).cents          += SOLANA_COST_CENTS;
  getAppBucket().cents                        += SOLANA_COST_CENTS;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Verify caller is a real authenticated Privy user.
  const userId = await getVerifiedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let walletAddress: string | undefined;
  try {
    const body = await req.json() as { walletAddress?: string };
    walletAddress = body.walletAddress?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!walletAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Invalid walletAddress" }, { status: 400 });
  }

  const result = canSponsor(walletAddress, userId);
  if (!result.allowed) {
    console.warn(`[sponsor-check] BLOCKED userId=${userId} wallet=${walletAddress.slice(0, 8)}… reason=${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }

  recordSpend(walletAddress, userId);
  console.info(`[sponsor-check] OK userId=${userId} wallet=${walletAddress.slice(0, 8)}… wallet=${getBucket(walletSpend, walletAddress).cents}¢ user=${getBucket(userSpend, userId).cents}¢ app=${getAppBucket().cents}¢`);
  return NextResponse.json({ ok: true });
}
