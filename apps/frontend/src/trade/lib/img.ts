const IPFS_URL = /^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)([A-Za-z0-9]+)(\/[^?#]*)?/;
const IPFS_SUBDOMAIN = /^https?:\/\/([a-z2-7]{40,100})\.ipfs\.[^/]+(\/[^?#]*)?/;

/**
 * Points IPFS pictures (ipfs://..., any /ipfs/<cid> gateway URL, or <cid>.ipfs.<host>) at our own
 * proxy, which races several gateways. Every other URL is returned as is.
 */
export function imgSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(IPFS_URL) ?? url.match(IPFS_SUBDOMAIN);
  if (!m) return url;
  const sub = (m[2] ?? "").replace(/^\/+/, "");
  return `/api/trade/img?cid=${encodeURIComponent(m[1])}${sub ? `&p=${encodeURIComponent(sub)}` : ""}`;
}
