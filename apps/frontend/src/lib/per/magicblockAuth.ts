import type { PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { EPHEMERAL_RPC_URL } from "@/lib/per/constants";
import { getSolanaCluster } from "@/lib/solanaCluster";

/**
 * MagicBlock TEE auth token fetch — resilient two-path strategy:
 *
 *   1. Same-origin proxy  /api/magicblock  (Next.js server-side, no CORS / CSP restrictions)
 *      → proxies to tee.magicblock.app server-side, so browser never touches it directly.
 *
 *   2. Direct TEE call    https://tee.magicblock.app  (or mainnet-tee on mainnet)
 *      → CSP allows it; works if the browser can reach the TEE endpoint directly.
 *
 * NOTE: devnet.magicblock.app is a JSON-RPC-only endpoint. It does NOT serve
 *       /auth/challenge or /auth/login — never use it for getAuthToken().
 *
 * The returned `baseUrl` is always `EPHEMERAL_RPC_URL` so that the Connection
 * used for ephemeral transactions matches the configured primary endpoint.
 */
export async function fetchMagicblockAuthToken(
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<{ token: string; baseUrl: string }> {
  const rpcBase = EPHEMERAL_RPC_URL.replace(/\/$/, "");
  const cluster = getSolanaCluster();
  const errors: string[] = [];

  const tryAuth = async (authBase: string): Promise<string | null> => {
    try {
      const res = await getAuthToken(authBase, publicKey, signMessage);
      const tokenStr = typeof res === "string" ? res : (res as { token?: string }).token;
      return tokenStr || null;
    } catch (e) {
      errors.push(`${authBase}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  // 1. Same-origin server proxy (bypasses CORS and CSP entirely).
  //    The proxy's upstream is tee.magicblock.app (set in /api/magicblock/[...path]/route.ts).
  if (typeof window !== "undefined") {
    const proxyBase = `${window.location.origin}/api/magicblock`;
    const token = await tryAuth(proxyBase);
    if (token) return { token, baseUrl: rpcBase };
  }

  // 2. Direct TEE call (fallback if proxy fails — e.g. server-side rendering context).
  const teeDirect =
    cluster === "mainnet-beta"
      ? "https://mainnet-tee.magicblock.app"
      : "https://tee.magicblock.app";

  const candidates = [rpcBase, teeDirect].filter((u, i, arr) => arr.indexOf(u) === i);

  for (const authBase of candidates) {
    const token = await tryAuth(authBase);
    if (token) return { token, baseUrl: rpcBase };
  }

  throw new Error(
    `MagicBlock getAuthToken failed (proxy + ${candidates.length} direct). ${errors.join(" | ")}`,
  );
}
