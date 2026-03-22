/**
 * Cluster label for UI (e.g. Devnet badge). Prefer NEXT_PUBLIC_SOLANA_CLUSTER.
 */
export type SolanaClusterName = "mainnet-beta" | "devnet" | "testnet";

export function getSolanaCluster(): SolanaClusterName {
  const c = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta").trim();
  if (c === "devnet" || c === "testnet" || c === "mainnet-beta") return c;
  return "mainnet-beta";
}

export function isNonMainnetCluster(): boolean {
  return getSolanaCluster() !== "mainnet-beta";
}

export function clusterBadgeLabel(): string | null {
  const c = getSolanaCluster();
  if (c === "mainnet-beta") return null;
  if (c === "devnet") return "Devnet";
  return "Testnet";
}

/** HTTP RPC for @solana/web3.js Connection (falls back by cluster). */
export function getSolanaHttpRpc(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  const cluster = getSolanaCluster();
  if (cluster === "devnet") return "https://api.devnet.solana.com";
  if (cluster === "testnet") return "https://api.testnet.solana.com";
  return process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
}

export function getSolanaWsRpc(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_WS_URL?.trim();
  if (explicit) return explicit;
  const cluster = getSolanaCluster();
  if (cluster === "devnet") return "wss://api.devnet.solana.com";
  if (cluster === "testnet") return "wss://api.testnet.solana.com";
  return process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `wss://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "wss://api.mainnet-beta.solana.com";
}
