import { PRIVATE_PAYMENT_ENABLED } from "@/services/privatePayment";

/**
 * Cluster label for UI (e.g. Devnet badge). Prefer NEXT_PUBLIC_SOLANA_CLUSTER.
 *
 * If cluster is **not** set, `NEXT_PUBLIC_ENABLE_PRIVATE_PAYMENT=true` defaults the
 * app to **devnet** (PER / private flows expect devnet unless you opt into mainnet).
 * Set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta` explicitly for mainnet PER.
 */
export type SolanaClusterName = "mainnet-beta" | "devnet" | "testnet";

export function getSolanaCluster(): SolanaClusterName {
  const raw = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim();
  if (raw === "devnet" || raw === "testnet" || raw === "mainnet-beta") return raw;
  if (raw) return "mainnet-beta";

  if (PRIVATE_PAYMENT_ENABLED) return "devnet";

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

/**
 * Privy `signAndSendTransaction({ chain })` — must match `config.solana.rpcs` keys in AuthProvider.
 * Without this, Privy defaults to mainnet for simulation/metadata while the app builds txs on devnet,
 * which breaks SPL metadata lookup (e.g. devnet USDC mint queried as mainnet-beta).
 */
export type PrivySolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

export function getPrivySolanaChain(): PrivySolanaChain {
  const c = getSolanaCluster();
  if (c === "devnet") return "solana:devnet";
  if (c === "testnet") return "solana:testnet";
  return "solana:mainnet";
}

/** HTTP RPC for @solana/web3.js Connection (falls back by cluster). */
export function getSolanaHttpRpc(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  const cluster = getSolanaCluster();
  if (cluster === "devnet") return "https://solana-devnet.g.alchemy.com/v2/KXLQJosl-B-y-awxxYRv8";
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
