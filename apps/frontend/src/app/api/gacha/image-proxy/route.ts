import { NextRequest, NextResponse } from 'next/server';

// Real Collector Crypt card scans (Collector Crypt's own CDN, plus the Arweave URLs some NFTs
// resolve to) don't send Access-Control-Allow-Origin — fine for a plain <img>/2D canvas (that's
// how GachaCard already displays them), but WebGL's texImage2D hard-refuses to upload a
// cross-origin image that wasn't loaded with CORS validation (throws SecurityError), which is
// exactly why GachaPack3D's real-card texture came back blank. Routing the fetch through our own
// origin sidesteps that: the browser only ever sees a same-origin response, so no CORS/taint
// restriction applies. The fetch itself happens server-side, which isn't subject to CORS at all.
const ALLOWED_HOSTS = [/(^|\.)collectorcrypt\.com$/, /(^|\.)cloudfront\.net$/, /(^|\.)arweave\.net$/];

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('url');
  if (!src) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  let target: URL;
  try { target = new URL(src); } catch { return NextResponse.json({ error: 'Invalid url' }, { status: 400 }); }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString());
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        // These are immutable NFT scans — safe to cache hard on both the browser and any CDN in front of this route.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }
}
