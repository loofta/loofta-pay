import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * IPFS image proxy. Coin pictures are usually pinned on IPFS and a single public gateway is often
 * slow, rate limited or blocked inside Telegram. We race several gateways on the server and hand
 * back the first real image. Only a content id plus an optional file path is accepted, never a
 * free URL, so this cannot be used to fetch arbitrary hosts.
 */

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{40,100})$/;
const SUBPATH = /^[A-Za-z0-9._\-/]{0,120}$/;
const MAX_BYTES = 2_000_000;

// Checked live 2026-11-12: ipfs.io, dweb.link, w3s.link and nftstorage.link answer 429 (rate
// limited) and cloudflare-ipfs.com no longer resolves, which is why direct links break. These four
// served images. They are raced, so a slow or dead one only costs us nothing.
const GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://4everland.io/ipfs/",
  "https://gateway.lighthouse.storage/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

async function fromGateway(base: string, path: string): Promise<{ body: ArrayBuffer; type: string }> {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  // Some gateways answer 200 with an HTML error page, only accept images.
  if (!type.startsWith("image/")) throw new Error("not an image");
  const body = await res.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) throw new Error("bad size");
  return { body, type };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const cid = sp.get("cid") ?? "";
  const sub = (sp.get("p") ?? "").replace(/^\/+/, "");
  if (!CID.test(cid) || !SUBPATH.test(sub) || sub.includes("..")) return new NextResponse("Bad request", { status: 400 });
  const path = sub ? `${cid}/${sub}` : cid;
  try {
    const { body, type } = await Promise.any(GATEWAYS.map((g) => fromGateway(g, path)));
    return new NextResponse(body, {
      headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=604800, immutable" },
    });
  } catch {
    // Short negative cache so a dead image does not hammer four gateways on every render.
    return new NextResponse("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  }
}
