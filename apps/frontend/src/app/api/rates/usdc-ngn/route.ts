import { NextResponse } from 'next/server';
import { getUsdcNgnRateSnapshot } from '@/lib/usdcNgnRate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getUsdcNgnRateSnapshot();
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
