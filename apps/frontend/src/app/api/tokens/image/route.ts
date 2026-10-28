import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NFT_BYTES = 6 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)\b/i;

const iconCache = new Map<string, { url: string | null; at: number }>();
const ICON_TTL_MS = 10 * 60 * 1000;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Only public https hosts: token metadata is attacker-controlled, so never let it point us at an internal address. */
async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('blocked');
  if (isIP(url.hostname)) throw new Error('blocked');
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked');
  return url;
}

async function iconFor(mint: string): Promise<string | null> {
  const hit = iconCache.get(mint);
  if (hit && Date.now() - hit.at < ICON_TTL_MS) return hit.url;
  const key = process.env.JUPITER_API_KEY ?? process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  let url: string | null = null;
  try {
    const r = await fetch(`https://api.jup.ag/tokens/v2/search?query=${mint}`, { headers: key ? { 'x-api-key': key } : {}, signal: AbortSignal.timeout(5_000), cache: 'no-store' });
    const list = (await r.json()) as Array<{ id?: string; icon?: string }>;
    const icon = Array.isArray(list) ? list.find((t) => t.id === mint)?.icon : undefined;
    url = typeof icon === 'string' ? icon : null;
  } catch {
    url = null;
  }
  iconCache.set(mint, { url, at: Date.now() });
  return url;
}

function toHttps(uri: string): string {
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

/** NFT artwork by asset id, read from the DAS index so the caller never supplies a URL. */
async function nftImageFor(id: string): Promise<string | null> {
  const hit = iconCache.get(`nft:${id}`);
  if (hit && Date.now() - hit.at < ICON_TTL_MS) return hit.url;
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  let url: string | null = null;
  if (rpc) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id } }),
        signal: AbortSignal.timeout(6_000),
        cache: 'no-store',
      });
      const c = (await r.json())?.result?.content;
      const img = c?.links?.image ?? c?.files?.[0]?.uri;
      url = typeof img === 'string' ? toHttps(img) : null;
    } catch {
      url = null;
    }
  }
  iconCache.set(`nft:${id}`, { url, at: Date.now() });
  return url;
}

/** Same-origin token icon: looks the icon up by mint, fetches it from a public host and serves it, so the page CSP never has to allow every token host. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const asset = params.get('asset') ?? '';
  const mint = params.get('mint') ?? '';
  const isNft = asset !== '';
  if (!BASE58.test(isNft ? asset : mint)) return new NextResponse(null, { status: 400 });
  const maxBytes = isNft ? MAX_NFT_BYTES : MAX_BYTES;
  const icon = isNft ? await nftImageFor(asset) : await iconFor(mint);
  if (!icon) return new NextResponse(null, { status: 404 });
  try {
    let current = icon;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicHttps(current);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8_000), headers: { Accept: 'image/*' } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, url).toString();
        continue;
      }
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !ALLOWED_TYPES.test(type)) return new NextResponse(null, { status: 404 });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > maxBytes) return new NextResponse(null, { status: 404 });
      return new NextResponse(buf, {
        headers: {
          'Content-Type': type.split(';')[0],
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
          'X-Content-Type-Options': 'nosniff',
          // An SVG here is only ever drawn through <img>; this stops it running anything if opened directly.
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      });
    }
  } catch {
    /* fall through */
  }
  return new NextResponse(null, { status: 404 });
}
