import { ConfigService } from '@nestjs/config';

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
