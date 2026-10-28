import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_MINTS = 50;

type JupToken = { id?: string; symbol?: string; name?: string; icon?: string; decimals?: number; usdPrice?: number };

/**
 * Token logos, names and USD prices for a list of Solana mints, from Jupiter's token API.
 * Proxied so the Jupiter key stays server-side and the browser makes a same-origin call.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('mints') ?? '';
  const mints = [...new Set(raw.split(',').map((m) => m.trim()).filter(Boolean))];
  if (mints.length === 0 || mints.length > MAX_MINTS || !mints.every((m) => BASE58.test(m))) {
    return NextResponse.json({ error: 'Invalid mints' }, { status: 400 });
  }
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  try {
    const res = await fetch(`https://api.jup.ag/tokens/v2/search?query=${mints.join(',')}`, {
      headers: key ? { 'x-api-key': key } : {},
      signal: AbortSignal.timeout(6_000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ tokens: [] }, { status: 200 });
    const data = (await res.json()) as JupToken[];
    const wanted = new Set(mints);
    const tokens = (Array.isArray(data) ? data : [])
      .filter((t) => t.id && wanted.has(t.id))
      .map((t) => ({
        mint: t.id as string,
        symbol: t.symbol ?? null,
        name: t.name ?? null,
        icon: typeof t.icon === 'string' && /^https?:\/\//.test(t.icon) ? t.icon : null,
        decimals: typeof t.decimals === 'number' ? t.decimals : null,
        usdPrice: typeof t.usdPrice === 'number' && t.usdPrice > 0 ? t.usdPrice : null,
      }));
    return NextResponse.json({ tokens }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  } catch {
    return NextResponse.json({ tokens: [] }, { status: 200 });
  }
}
