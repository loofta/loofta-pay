/**
 * Unified Cron Job: Process All Pending Payments
 * 
 * This single cron job calls all three processing endpoints:
 * 1. Lottery ticket purchases
 * 2. 2-hop cross-chain swaps
 * 3. Same-chain token swaps
 * 
 * Schedule: Every minute (configured in vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  console.log("[process-all] Starting unified cron job...");
  
  // Build base URL from request
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  const results: any = {
    lottery: null,
    claims: null,
    swaps: null,
    orgSwaps: null,
  };
  
  const authBearer = `Bearer ${process.env.CRON_SECRET || ""}`;
  
  // Process lottery payments
  try {
    const lotteryRes = await fetch(`${baseUrl}/api/cron/process-payments`, {
      headers: { "Authorization": authBearer },
    });
    results.lottery = await lotteryRes.json();
    console.log("[process-all] Lottery:", results.lottery);
  } catch (e: any) {
    console.error("[process-all] Lottery error:", e);
    results.lottery = { error: e?.message };
  }
  
  // Process 2-hop claims
  try {
    const claimsRes = await fetch(`${baseUrl}/api/cron/process-claims`, {
      headers: { "Authorization": authBearer },
    });
    results.claims = await claimsRes.json();
    console.log("[process-all] Claims:", results.claims);
  } catch (e: any) {
    console.error("[process-all] Claims error:", e);
    results.claims = { error: e?.message };
  }
  
  // Process swaps (claims)
  try {
    const swapsRes = await fetch(`${baseUrl}/api/cron/process-swaps`, {
      headers: { "Authorization": authBearer },
    });
    results.swaps = await swapsRes.json();
    console.log("[process-all] Swaps:", results.swaps);
  } catch (e: any) {
    console.error("[process-all] Swaps error:", e);
    results.swaps = { error: e?.message };
  }
  
  // Process organization swaps
  try {
    const orgSwapsRes = await fetch(`${baseUrl}/api/cron/process-org-swaps`, {
      headers: { "Authorization": authBearer },
    });
    results.orgSwaps = await orgSwapsRes.json();
    console.log("[process-all] Org Swaps:", results.orgSwaps);
  } catch (e: any) {
    console.error("[process-all] Org Swaps error:", e);
    results.orgSwaps = { error: e?.message };
  }
  
  console.log("[process-all] Complete");
  
  return NextResponse.json({ 
    success: true, 
    timestamp: new Date().toISOString(),
    ...results 
  });
}
