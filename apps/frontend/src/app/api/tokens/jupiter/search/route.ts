import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type JupToken = {
  id?: string;
  symbol?: string;
  name?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  liquidity?: number;
  isVerified?: boolean;
  tokenProgram?: string;
};

const CLASSIC_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Jupiter token search for the swap picker. `q` can be a name, a symbol or a full mint address.
 * Without `q` it returns Jupiter's popular tokens. Only classic-program tokens are returned,
 * which is what in-app swaps support. The Jupiter key stays on the server.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length > 64 || !/^[\w .\-$]*$/.test(q)) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  const url = q
    ? `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(q)}`
    : 'https://api.jup.ag/tokens/v2/toporganicscore/24h?limit=40';
  try {
    const res = await fetch(url, { headers: key ? { 'x-api-key': key } : {}, signal: AbortSignal.timeout(6_000), cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ tokens: [] });
    const data = (await res.json()) as JupToken[];
    const tokens = (Array.isArray(data) ? data : [])
      .filter((t) => t.id && t.tokenProgram === CLASSIC_TOKEN_PROGRAM && typeof t.decimals === 'number')
      .slice(0, 40)
      .map((t) => ({
        mint: t.id as string,
        symbol: t.symbol ?? '',
        name: t.name ?? t.symbol ?? '',
        icon: typeof t.icon === 'string' && /^https?:\/\//.test(t.icon) ? t.icon : null,
        decimals: t.decimals as number,
        usdPrice: typeof t.usdPrice === 'number' && t.usdPrice > 0 ? t.usdPrice : null,
        verified: !!t.isVerified,
      }));
    return NextResponse.json({ tokens }, { headers: { 'Cache-Control': q ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=120' } });
  } catch {
    return NextResponse.json({ tokens: [] });
  }
}
