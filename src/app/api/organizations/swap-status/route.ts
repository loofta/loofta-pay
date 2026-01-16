/**
 * GET /api/organizations/swap-status
 * 
 * Debug endpoint to check the status of an organization companion swap
 * 
 * Query params:
 * - organizationId: string (required)
 * - createdAt: number (optional, timestamp when swap was created)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";

async function getRedis() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const client = createClient({ url: redisUrl });
  if (!client.isOpen) await client.connect();
  return client;
}

const SWAP_COMPANION_PREFIX = "org_swap_companion:";
const SWAP_PENDING_KEY = "org_swap_pending";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }
    
    const redis = await getRedis();
    
    // Get all pending keys
    const pendingKeys = await redis.sMembers(SWAP_PENDING_KEY);
    console.log(`[swap-status] Found ${pendingKeys.length} pending swaps`);
    
    // Find matching swaps
    const matchingSwaps: any[] = [];
    
    for (const redisKey of pendingKeys) {
      if (!redisKey.includes(organizationId)) continue;
      
      const dataStr = await redis.get(redisKey);
      if (!dataStr) continue;
      
      const data = JSON.parse(dataStr);
      if (data.organizationId === organizationId) {
        matchingSwaps.push({
          redisKey,
          ...data,
          createdAtDate: new Date(data.createdAt).toISOString(),
          updatedAtDate: new Date(data.updatedAt).toISOString(),
          ageMinutes: Math.floor((Date.now() - data.createdAt) / 1000 / 60),
        });
      }
    }
    
    // Also check all keys with the prefix (in case it's not in pending set)
    const allKeys = await redis.keys(`${SWAP_COMPANION_PREFIX}${organizationId}:*`);
    console.log(`[swap-status] Found ${allKeys.length} total keys for org ${organizationId}`);
    
    const allSwaps: any[] = [];
    for (const key of allKeys) {
      const dataStr = await redis.get(key);
      if (!dataStr) continue;
      
      const data = JSON.parse(dataStr);
      allSwaps.push({
        redisKey: key,
        ...data,
        createdAtDate: new Date(data.createdAt).toISOString(),
        updatedAtDate: new Date(data.updatedAt).toISOString(),
        ageMinutes: Math.floor((Date.now() - data.createdAt) / 1000 / 60),
        isPending: pendingKeys.includes(key),
      });
    }
    
    return NextResponse.json({
      success: true,
      organizationId,
      pendingSwaps: matchingSwaps,
      allSwaps: allSwaps.sort((a, b) => b.createdAt - a.createdAt), // Most recent first
      pendingCount: matchingSwaps.length,
      totalCount: allSwaps.length,
    });
    
  } catch (e: any) {
    console.error("[swap-status] Error:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
