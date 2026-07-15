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

/**
 * HTTP RPC for @solana/web3.js Connection. Alchemy (NEXT_PUBLIC_SOLANA_RPC_URL /
 * NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL) takes priority when set, then Helius, then public —
 * see memory/project_alchemy_rpc_fallback.md for why.
 */
export function getSolanaHttpRpc(): string {
  const cluster = getSolanaCluster();
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (cluster === "devnet") {
    return (
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL?.trim() ||
      (key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "") ||
      "https://api.devnet.solana.com"
    );
  }
  if (cluster === "testnet") return "https://api.testnet.solana.com";
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    (key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "") ||
    "https://api.mainnet-beta.solana.com"
  );
}

/** Secondary HTTP RPC for the active cluster — Helius when Alchemy is primary. Null if only one is configured. */
export function getSolanaHttpRpcFallback(): string | null {
  const cluster = getSolanaCluster();
  const key = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  const alchemyUrl = (cluster === "devnet"
    ? process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL
    : process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  )?.trim();
  if (!alchemyUrl || !key) return null;
  return cluster === "devnet"
    ? `https://devnet.helius-rpc.com/?api-key=${key}`
    : `https://mainnet.helius-rpc.com/?api-key=${key}`;
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
