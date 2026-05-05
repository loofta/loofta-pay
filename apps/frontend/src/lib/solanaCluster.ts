export type SolanaClusterName = "mainnet-beta" | "devnet" | "testnet";

export function getSolanaCluster(): SolanaClusterName {
  const raw = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim();
  if (raw === "devnet" || raw === "testnet" || raw === "mainnet-beta") return raw;
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

/** HTTP RPC for @solana/web3.js Connection. Helius key takes priority over explicit URL. */
export function getSolanaHttpRpc(): string {
  const cluster = getSolanaCluster();
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (cluster === "devnet") {
    if (key) return `https://devnet.helius-rpc.com/?api-key=${key}`;
    return (
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
      "https://api.devnet.solana.com"
    );
  }
  if (cluster === "testnet") return "https://api.testnet.solana.com";
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

export function getSolanaWsRpc(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_WS_URL?.trim();
  if (explicit) return explicit;
  const cluster = getSolanaCluster();
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (cluster === "devnet") {
    return key ? `wss://devnet.helius-rpc.com/?api-key=${key}` : "wss://api.devnet.solana.com";
  }
  if (cluster === "testnet") return "wss://api.testnet.solana.com";
  return key
    ? `wss://mainnet.helius-rpc.com/?api-key=${key}`
    : "wss://api.mainnet-beta.solana.com";
}
