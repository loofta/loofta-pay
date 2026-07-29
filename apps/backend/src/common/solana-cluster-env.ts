import { ConfigService } from '@nestjs/config';

/**
 * Hardcoded mainnet RPC — Lisa's paid Alchemy plan (see project_alchemy_rpc_fallback memory).
 * Deliberately not env-driven: Railway's SOLANA_RPC_URL was inconsistently set/stale across
 * services, which silently dropped some of them back to Helius or the public rate-limited
 * endpoint and was part of the 2026-07-29 429 storm. This is the single source of truth for
 * every backend Connection on mainnet; Alchemy has no devnet endpoint, so devnet paths are
 * unaffected and stay env/Helius/public as before.
 */
export const ALCHEMY_MAINNET_RPC_URL = 'https://solana-mainnet.g.alchemy.com/v2/KXLQJosl-B-y-awxxYRv8';

/**
 * Mainnet RPC: hardcoded Alchemy primary, HELIUS_API_KEY fallback, public RPC last resort.
 * The Alchemy constant is checked for truthiness so clearing it (e.g. credits exhausted) drops
 * straight to Helius/public without touching call sites.
 */
export function getMainnetSolanaRpcUrl(configService: ConfigService): string {
  if (ALCHEMY_MAINNET_RPC_URL) return ALCHEMY_MAINNET_RPC_URL;
  const helius = configService.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return 'https://api.mainnet-beta.solana.com';
}

/**
 * True when backend env targets Solana devnet or testnet (non-mainnet).
 * Matches frontend NEXT_PUBLIC_SOLANA_CLUSTER / SOLANA_RPC_URL heuristics.
 */
export function isSolanaDevnetFromConfig(configService: ConfigService): boolean {
  const cluster =
    configService.get<string>('SOLANA_CLUSTER')?.trim() ||
    configService.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim();
  if (cluster === 'devnet' || cluster === 'testnet') return true;
  if (cluster === 'mainnet-beta') return false;
  const rpc = (configService.get<string>('SOLANA_RPC_URL') || '').toLowerCase();
  if (rpc.includes('devnet') || rpc.includes('testnet')) return true;
  return false;
}

export function isSolanaLocalhostFromConfig(configService: ConfigService): boolean {
  const cluster =
    configService.get<string>('SOLANA_CLUSTER')?.trim() ||
    configService.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim();
  if (cluster === 'localnet' || cluster === 'localhost') return true;
  const rpc = (configService.get<string>('SOLANA_RPC_URL') || '').toLowerCase();
  return rpc.includes('localhost') || rpc.includes('127.0.0.1');
}
