'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Calculate average payment times per route (from_chain + to_chain)
 * Returns average time in seconds from deposit received to payment completed.
 * Reads from the new `payments` / `payment_intents` tables.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromChain = searchParams.get("fromChain");

    const supabase = getSupabaseAdmin();

    const { data: payments, error } = await supabase
      .from("payments")
      .select(`
        id,
        created_at,
        paid_at,
        payment_intents!inner(
          status,
          from_chain,
          to_chain
        )
      `)
      .eq("status", "SUCCESS")
      .not("paid_at", "is", null);

    if (error) {
      console.error("[payment-times] Error fetching payments:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!payments || payments.length === 0) {
      return NextResponse.json({ averages: {}, totalSamples: 0 }, { status: 200 });
    }

    type RouteKey = string;
    const routeTimes: Record<RouteKey, number[]> = {};

    for (const payment of payments) {
      if (!payment.paid_at) continue;

      const intent = Array.isArray(payment.payment_intents)
        ? payment.payment_intents[0]
        : payment.payment_intents;

      if (!intent) continue;

      const fromChainValue = intent.from_chain ? String(intent.from_chain).toLowerCase() : null;
      const toChainValue = intent.to_chain ? String(intent.to_chain).toLowerCase() : "solana";

      if (fromChain && fromChainValue && fromChainValue !== fromChain.toLowerCase()) continue;

      // Use created_at as proxy for deposit received (payment_intents no longer stores deposit_received_at)
      const depositTime = new Date(payment.created_at).getTime();
      const paidTime = new Date(payment.paid_at).getTime();
      const durationSeconds = Math.floor((paidTime - depositTime) / 1000);

      if (durationSeconds < 0 || durationSeconds > 3600) continue;

      const routeKey = fromChainValue
        ? `${fromChainValue}->${toChainValue}`
        : `unknown->${toChainValue}`;

      if (!routeTimes[routeKey]) routeTimes[routeKey] = [];
      routeTimes[routeKey].push(durationSeconds);
    }

    const averages: Record<string, { averageSeconds: number; sampleCount: number; minSeconds: number; maxSeconds: number }> = {};

    for (const [route, times] of Object.entries(routeTimes)) {
      if (times.length === 0) continue;
      const sum = times.reduce((a, b) => a + b, 0);
      averages[route] = {
        averageSeconds: Math.round(sum / times.length),
        sampleCount: times.length,
        minSeconds: Math.min(...times),
        maxSeconds: Math.max(...times),
      };
    }

    const totalSamples = Object.values(routeTimes).reduce((sum, times) => sum + times.length, 0);

    return NextResponse.json({
      averages,
      totalSamples,
      generalAverage: totalSamples > 0
        ? Math.round(Object.values(routeTimes).flat().reduce((a, b) => a + b, 0) / totalSamples)
        : null,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[payment-times] Error:", e);
    return NextResponse.json({ error: e?.message || "Failed to calculate payment times" }, { status: 500 });
  }
}
