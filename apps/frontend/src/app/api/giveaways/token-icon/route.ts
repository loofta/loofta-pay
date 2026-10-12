import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const MAX_BYTES = 1_500_000;

/**
 * Same-origin token logo. Jupiter icons live on arbitrary hosts (Arweave, IPFS, CDNs) that the
 * page Content-Security-Policy does not allow, so the browser never loads them directly. This
 * route looks the mint up and fetches only the logo Jupiter returned for it.
 */
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get("mint")?.trim() ?? "";
  if (mint.length < 32 || mint.length > 64) {
    return new NextResponse(null, { status: 400 });
  }

  const search = await fetch(`${BACKEND_URL}/giveaways/public/tokens?q=${encodeURIComponent(mint)}`).catch(() => null);
  if (!search?.ok) return new NextResponse(null, { status: 404 });

  const body = await search.json().catch(() => null);
  const tokens = Array.isArray(body?.tokens) ? body.tokens : [];
  const hit = tokens.find((t: { mint?: string }) => t.mint === mint) ?? tokens[0];
  const logo = typeof hit?.logo === "string" ? hit.logo : "";
  const fetched = await fetchLogo(logoCandidates(logo));
  if (!fetched) return new NextResponse(null, { status: 404 });

  return new NextResponse(fetched.bytes, {
    headers: {
      "Content-Type": fetched.type,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/** nftstorage and the public IPFS gateways often 403 or 429. Pinata serves the same CID. */
function logoCandidates(logo: string): string[] {
  const raw = logo.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${logo.slice("ipfs://".length)}` : logo;
  const cid = ipfsCid(raw);
  const pinata = cid ? `https://gateway.pinata.cloud/ipfs/${cid}` : "";
  const flaky = /nftstorage\.link|ipfs\.io|dweb\.link|w3s\.link|cloudflare-ipfs\.com/i.test(raw);
  const ordered = flaky && pinata ? [pinata, raw] : [raw, pinata];
  return [...new Set(ordered.filter(Boolean))];
}

function ipfsCid(raw: string): string | null {
  const match = raw.match(/(baf[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})/);
  return match ? match[1] : null;
}

async function fetchLogo(urls: string[]): Promise<{ bytes: Uint8Array; type: string } | null> {
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    const img = await fetch(parsed, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    }).catch(() => null);
    if (!img?.ok) continue;
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue;
    const type = imageType(img.headers.get("content-type") ?? "", bytes);
    if (!type) continue;
    return { bytes, type };
  }
  return null;
}

function imageType(header: string, bytes: Uint8Array): string | null {
  const declared = header.split(";")[0].trim().toLowerCase();
  if (declared === "image/svg+xml") return declared;
  if (declared === "image/png" || declared === "image/jpeg" || declared === "image/gif" || declared === "image/webp") return declared;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 240)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}
