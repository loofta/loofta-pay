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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

// Permanently blocked Privy user IDs (attackers, abusers).
const BLOCKED_PRIVY_IDS = new Set([
  "cih671wjoh1agoah95o50gb5", // ATA-rent drain attacker #1, July 2026
  "p4kh3hw0m2jzvti016fc7378", // ATA-rent drain attacker #2, July 2026
]);

// ─── Config ──────────────────────────────────────────────────────────────────

const LIMITS = {
  perWalletDailyCents:  200,  // $2   / wallet / day
  perUserDailyCents:    500,  // $5   / user   / day
  perIpDailyCents:     1000,  // $10  / IP     / day  — blocks multi-account attacks
  perAppDailyCents:   10000,  // $100 / app    / day  (Privy recipe default)

  // Hard tx-count ceilings (Privy security docs recommendation).
  // Without these, $0.01 cost estimate × $2 cap = 200 txs/day.
  // ATA rent is $0.40/tx so 200 txs = $80 real damage. Count limits close that gap.
  perWalletDailyTxs:    20,   // 20 sends/wallet/day is plenty for any legitimate user
  perIpDailyTxs:        50,   // 50 sends/IP/day across all wallets
};

// Privy recipe: Solana normal tx ≈ $0.01.
const SOLANA_COST_CENTS = 1;

// ─── In-process spend tracking ────────────────────────────────────────────────
// Resets on deploy/restart. Each Next.js server process maintains its own Map.
// For a distributed / serverless fleet, swap for Redis (Upstash) or Supabase.

type DailyBucket = { date: string; cents: number; txCount: number };

const walletSpend = new Map<string, DailyBucket>();
const userSpend   = new Map<string, DailyBucket>();
const ipSpend     = new Map<string, DailyBucket>();
let   appSpend: DailyBucket = { date: "", cents: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getBucket(map: Map<string, DailyBucket>, key: string): DailyBucket {
  const today = todayUTC();
  const existing = map.get(key);
  if (existing && existing.date === today) return existing;
  const fresh: DailyBucket = { date: today, cents: 0, txCount: 0 };
  map.set(key, fresh);
  return fresh;
}

function getAppBucket(): DailyBucket {
  const today = todayUTC();
  if (appSpend.date !== today) appSpend = { date: today, cents: 0, txCount: 0 };
  return appSpend;
}

function canSponsor(walletAddress: string, userId: string, ip: string): { allowed: boolean; reason?: string } {
  const walletBucket = getBucket(walletSpend, walletAddress);
  if (walletBucket.txCount >= LIMITS.perWalletDailyTxs) {
    return { allowed: false, reason: `Daily send limit reached for this wallet (${LIMITS.perWalletDailyTxs} sends/day). Try again tomorrow.` };
  }
  if (walletBucket.cents + SOLANA_COST_CENTS > LIMITS.perWalletDailyCents) {
    return { allowed: false, reason: `Daily spend limit reached for this wallet ($${LIMITS.perWalletDailyCents / 100}). Try again tomorrow.` };
  }

  const userBucket = getBucket(userSpend, userId);
  if (userBucket.cents + SOLANA_COST_CENTS > LIMITS.perUserDailyCents) {
    return { allowed: false, reason: `Daily spend limit reached for this account ($${LIMITS.perUserDailyCents / 100}). Try again tomorrow.` };
  }

  const ipBucket = getBucket(ipSpend, ip);
  if (ipBucket.txCount >= LIMITS.perIpDailyTxs) {
    return { allowed: false, reason: "Too many requests from your network. Try again tomorrow." };
  }
  if (ipBucket.cents + SOLANA_COST_CENTS > LIMITS.perIpDailyCents) {
    return { allowed: false, reason: "Too many requests from your network. Try again tomorrow." };
  }

  const appBucket = getAppBucket();
  if (appBucket.cents + SOLANA_COST_CENTS > LIMITS.perAppDailyCents) {
    return { allowed: false, reason: "Platform send limit reached. Please try again later." };
  }

  return { allowed: true };
}

function recordSpend(walletAddress: string, userId: string, ip: string) {
  const wb = getBucket(walletSpend, walletAddress);
  wb.cents += SOLANA_COST_CENTS; wb.txCount++;

  const ub = getBucket(userSpend, userId);
  ub.cents += SOLANA_COST_CENTS; ub.txCount++;

  const ib = getBucket(ipSpend, ip);
  ib.cents += SOLANA_COST_CENTS; ib.txCount++;

  const ab = getAppBucket();
  ab.cents += SOLANA_COST_CENTS; ab.txCount++;
}

// ─── Route handler ────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  // Railway (and most proxies) set x-forwarded-for; take the first (leftmost) IP.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function isRegisteredLooftaUser(privyUserId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?privy_user_id=eq.${encodeURIComponent(privyUserId)}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } },
    );
    if (!res.ok) return false;
    const rows = await res.json() as unknown[];
    return rows.length > 0;
  } catch {
    // Fail-open: if Supabase is unreachable, don't block legitimate users.
    return true;
  }
}

export async function POST(req: NextRequest) {
  // Verify caller is a real authenticated Privy user.
  const userId = await getVerifiedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Block permanently banned identities immediately.
  if (BLOCKED_PRIVY_IDS.has(userId)) {
    console.warn(`[sponsor-check] BANNED userId=${userId}`);
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Only fully onboarded Loofta users get gas sponsorship.
  // This closes the "logged in but never registered" exploit path.
  const registered = await isRegisteredLooftaUser(userId);
  if (!registered) {
    console.warn(`[sponsor-check] UNREGISTERED userId=${userId} — sponsorship denied`);
    return NextResponse.json({ error: "Complete your Loofta account setup before sending." }, { status: 403 });
  }

  const ip = getClientIp(req);

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

  const result = canSponsor(walletAddress, userId, ip);
  if (!result.allowed) {
    console.warn(`[sponsor-check] BLOCKED ip=${ip} userId=${userId} wallet=${walletAddress.slice(0, 8)}… reason=${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }

  recordSpend(walletAddress, userId, ip);
  console.info(`[sponsor-check] OK ip=${ip} userId=${userId} wallet=${walletAddress.slice(0, 8)}… wallet=${getBucket(walletSpend, walletAddress).cents}¢ user=${getBucket(userSpend, userId).cents}¢ ip=${getBucket(ipSpend, ip).cents}¢ app=${getAppBucket().cents}¢`);
  return NextResponse.json({ ok: true });
}
