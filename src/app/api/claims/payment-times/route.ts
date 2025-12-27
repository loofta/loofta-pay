'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Calculate average payment times per route (from_chain + to_chain)
 * Returns average time in seconds from deposit received to payment completed
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromChain = searchParams.get("fromChain");
    const toChain = searchParams.get("toChain");
    
    const supabase = getSupabaseAdmin();
    
    // Build query to get completed payments with timing data
    // Now we have from_chain and to_chain stored directly in claim_intents
    let query = supabase
      .from("claims")
      .select(`
        id,
        to_chain,
        created_at,
        paid_at,
        claim_intents!inner(
          deposit_received_at,
          status,
          paid_with,
          from_chain,
          to_chain,
          payment_duration
        )
      `)
      .eq("status", "SUCCESS")
      .not("paid_at", "is", null);
    
    // Filter by chains if provided
    if (toChain) {
      query = query.eq("to_chain", toChain);
    }
    
    const { data: claims, error } = await query;
    
    if (error) {
      console.error("[payment-times] Error fetching claims:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (!claims || claims.length === 0) {
      return NextResponse.json({ 
        averages: {},
        totalSamples: 0 
      }, { status: 200 });
    }
    
    // Group by route and calculate averages
    type RouteKey = string;
    type PaymentTime = number;
    const routeTimes: Record<RouteKey, PaymentTime[]> = {};
    
    for (const claim of claims) {
      const intent = Array.isArray(claim.claim_intents) 
        ? claim.claim_intents[0] 
        : claim.claim_intents;
      
      // Skip if deposit_received_at column doesn't exist or is null
      if (!intent || !claim.paid_at) continue;
      const depositReceivedAt = (intent as any)?.deposit_received_at;
      if (!depositReceivedAt) continue;
      
      // Use stored from_chain and to_chain, fallback to extraction from paid_with
      let fromChainValue: string | null = intent.from_chain 
        ? String(intent.from_chain).toLowerCase()
        : null;
      
      // Fallback: Extract from paid_with if not stored
      if (!fromChainValue && intent.paid_with) {
        const match = String(intent.paid_with).match(/on\s+(\w+)/i);
        if (match) {
          fromChainValue = match[1].toLowerCase();
        }
      }
      
      // Use stored to_chain from intent, fallback to claim.to_chain
      const toChainValue = intent.to_chain 
        ? String(intent.to_chain).toLowerCase()
        : String(claim.to_chain || "").toLowerCase();
      
      if (!toChainValue) continue;
      
      // If fromChain filter is provided, skip if doesn't match
      if (fromChain && fromChainValue && fromChainValue !== fromChain.toLowerCase()) {
        continue;
      }
      
      // Use stored payment_duration if available, otherwise calculate
      let durationSeconds: number;
      if (intent.payment_duration && typeof intent.payment_duration === 'number') {
        durationSeconds = intent.payment_duration;
      } else if (depositReceivedAt) {
        // Calculate from timestamps if deposit_received_at exists
        const depositReceived = new Date(depositReceivedAt).getTime();
        const paidAt = new Date(claim.paid_at).getTime();
        durationSeconds = Math.floor((paidAt - depositReceived) / 1000);
      } else {
        // Skip if we can't calculate duration
        continue;
      }
      
      // Skip invalid durations (negative or too large)
      if (durationSeconds < 0 || durationSeconds > 3600) continue; // Max 1 hour
      
      // Create route key: "fromChain->toChain" or just "toChain" if fromChain unknown
      const routeKey = fromChainValue 
        ? `${fromChainValue}->${toChainValue}`
        : `unknown->${toChainValue}`;
      
      if (!routeTimes[routeKey]) {
        routeTimes[routeKey] = [];
      }
      routeTimes[routeKey].push(durationSeconds);
    }
    
    // Calculate averages per route
    const averages: Record<string, { averageSeconds: number; sampleCount: number; minSeconds: number; maxSeconds: number }> = {};
    
    for (const [route, times] of Object.entries(routeTimes)) {
      if (times.length === 0) continue;
      
      const sum = times.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / times.length);
      const min = Math.min(...times);
      const max = Math.max(...times);
      
      averages[route] = {
        averageSeconds: avg,
        sampleCount: times.length,
        minSeconds: min,
        maxSeconds: max,
      };
    }
    
    const totalSamples = Object.values(routeTimes).reduce((sum, times) => sum + times.length, 0);
    
    return NextResponse.json({
      averages,
      totalSamples,
      // Also return a general average if no specific route match
      generalAverage: totalSamples > 0 
        ? Math.round(
            Object.values(routeTimes)
              .flat()
              .reduce((a, b) => a + b, 0) / totalSamples
          )
        : null,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[payment-times] Error:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to calculate payment times" },
      { status: 500 }
    );
  }
}

