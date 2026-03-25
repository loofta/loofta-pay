import type { PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { EPHEMERAL_RPC_URL } from "@/lib/per/constants";
import { getSolanaCluster, type SolanaClusterName } from "@/lib/solanaCluster";

/** JSON-RPC + token must use this host; must match server proxy upstream (see /api/magicblock/auth/*). */
function connectionBaseUrl(): string {
  return EPHEMERAL_RPC_URL.replace(/\/$/, "");
}

function buildAuthBaseCandidates(primary: string, cluster: SolanaClusterName): string[] {
  const add = (list: string[], u: string) => {
    const x = u.replace(/\/$/, "");
    if (!list.includes(x)) list.push(x);
  };
  const out: string[] = [];
  add(out, primary);
  if (cluster !== "mainnet-beta") {
    add(out, "https://devnet.magicblock.app");
    add(out, "https://tee.magicblock.app");
  } else {
    add(out, "https://mainnet-tee.magicblock.app");
  }
  return out;
}

/**
 * MagicBlock SDK calls GET /auth/challenge and POST /auth/login on the given base.
 * Browser direct calls to *.magicblock.app often fail with "Failed to fetch" (CORS / mixed rules).
 * We first use same-origin `/api/magicblock` (proxied on the server); then fall back to direct URLs.
 */
export async function fetchMagicblockAuthToken(
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<{ token: string; baseUrl: string }> {
  const rpcBase = connectionBaseUrl();

  if (typeof window !== "undefined") {
    const proxyBase = `${window.location.origin}/api/magicblock`;
    try {
      const res = await getAuthToken(proxyBase, publicKey, signMessage);
      const tokenStr = typeof res === "string" ? res : (res as { token: string }).token;
      if (!tokenStr) throw new Error("Empty token from MagicBlock auth");
      return { token: tokenStr, baseUrl: rpcBase };
    } catch {
      // fall through to direct
    }
  }

  const cluster = getSolanaCluster();
  const candidates = buildAuthBaseCandidates(EPHEMERAL_RPC_URL, cluster);
  const errors: string[] = [];

  for (const baseUrl of candidates) {
    try {
      const res = await getAuthToken(baseUrl, publicKey, signMessage);
      const tokenStr = typeof res === "string" ? res : (res as { token: string }).token;
      if (!tokenStr) throw new Error("Empty token from MagicBlock auth");
      return { token: tokenStr, baseUrl: rpcBase };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${baseUrl}: ${msg}`);
    }
  }

  throw new Error(`MagicBlock getAuthToken failed (proxy + ${candidates.length} direct). ${errors.join(" | ")}`);
}
