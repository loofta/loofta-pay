import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RhinestoneChainConfig {
  chainId: number;
  name: string;
  tokens: string[];
  active: boolean;
}

export interface RhinestoneIntentResponse {
  id: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  companionAddress?: string;
  fundingAmount?: string;
  meta?: any;
}

export interface RhinestoneStatusResponse {
  id?: string;
  status: 'PENDING' | 'PRECONFIRMED' | 'CLAIMED' | 'FILLED' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | string;
  txHash?: string;
  error?: string;
}

// Supported chains configuration
const RHINESTONE_CHAINS: Record<string, RhinestoneChainConfig> = {
  ethereum: { chainId: 1, name: 'Ethereum', tokens: ['ETH', 'WETH', 'USDC', 'USDT'], active: true },
  base: { chainId: 8453, name: 'Base', tokens: ['ETH', 'WETH', 'USDC', 'USDT'], active: true },
  optimism: { chainId: 10, name: 'Optimism', tokens: ['ETH', 'WETH', 'USDC', 'USDT'], active: true },
  arbitrum: { chainId: 42161, name: 'Arbitrum One', tokens: ['ETH', 'WETH', 'USDC', 'USDT'], active: true },
  polygon: { chainId: 137, name: 'Polygon', tokens: ['WETH', 'USDC', 'USDT'], active: true },
  zksync: { chainId: 324, name: 'zkSync', tokens: ['ETH', 'WETH', 'USDC', 'USDT'], active: true },
};

// Chain aliases
const CHAIN_ALIASES: Record<string, string> = {
  eth: 'ethereum',
  mainnet: 'ethereum',
  op: 'optimism',
  arb: 'arbitrum',
  matic: 'polygon',
  pol: 'polygon',
  zk: 'zksync',
  'zksync-era': 'zksync',
};

@Injectable()
export class RhinestoneService implements OnModuleInit {
  private readonly logger = new Logger(RhinestoneService.name);
  private readonly apiBase: string;
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiBase = this.configService.get<string>(
      'RHINESTONE_API_BASE',
      'https://v1.orchestrator.rhinestone.dev',
    );
    this.apiKey = this.configService.get<string>('RHINESTONE_API_KEY');
  }

  onModuleInit() {
    if (this.apiKey) {
      this.logger.log('Rhinestone service initialized with API key');
    } else {
      this.logger.warn('Rhinestone API key not configured');
    }
  }

  /**
   * Normalize chain name to Rhinestone key
   */
  normalizeChainKey(chain?: string): string {
    const c = String(chain || '').toLowerCase().trim().replace(/[\s_]+/g, '-');
    if (RHINESTONE_CHAINS[c]) return c;
    if (CHAIN_ALIASES[c]) return CHAIN_ALIASES[c];

    // Partial matches
    if (c.includes('base')) return 'base';
    if (c.includes('polygon') || c.includes('matic')) return 'polygon';
    if (c.includes('arbitrum')) return 'arbitrum';
    if (c.includes('optimism')) return 'optimism';
    if (c.includes('zksync')) return 'zksync';

    return c;
  }

  /**
   * Check if chain is supported
   */
  isSupportedChain(chain?: string): boolean {
    const key = this.normalizeChainKey(chain);
    return RHINESTONE_CHAINS[key]?.active === true;
  }

  /**
   * Get chain ID
   */
  getChainId(chain?: string): number | undefined {
    const key = this.normalizeChainKey(chain);
    return RHINESTONE_CHAINS[key]?.chainId;
  }

  /**
   * Get chain configuration
   */
  getChainConfig(chain?: string): RhinestoneChainConfig | undefined {
    const key = this.normalizeChainKey(chain);
    return RHINESTONE_CHAINS[key];
  }

  /**
   * Check if token is supported on a chain
   */
  isSupportedToken(chain?: string, tokenSymbol?: string): boolean {
    const config = this.getChainConfig(chain);
    if (!config?.active) return false;
    const symbol = String(tokenSymbol || '').toUpperCase();
    return config.tokens.includes(symbol);
  }

  /**
   * Check if swap pair is supported
   */
  isSwapSupported(fromSymbol: string, toSymbol: string, chainId: number): boolean {
    // Get chain key from chainId
    const chainConfig = Object.values(RHINESTONE_CHAINS).find(
      (c) => c.chainId === chainId && c.active,
    );
    if (!chainConfig) return false;

    const from = fromSymbol.toUpperCase();
    const to = toSymbol.toUpperCase();

    return chainConfig.tokens.includes(from) && chainConfig.tokens.includes(to);
  }

  /**
   * Get authorization headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    return headers;
  }

  /**
   * Get all active chain IDs
   */
  getActiveChainIds(): number[] {
    return Object.values(RHINESTONE_CHAINS)
      .filter((c) => c.active)
      .map((c) => c.chainId);
  }

  /**
   * Check if Rhinestone can be used for a swap
   */
  canUseRhinestone(params: {
    fromChain: string;
    toChain: string;
    fromSymbol?: string;
    toSymbol?: string;
  }): { eligible: boolean; reason?: string } {
    const { fromChain, toChain, fromSymbol, toSymbol } = params;

    if (fromChain.toLowerCase() !== toChain.toLowerCase()) {
      return { eligible: false, reason: 'Cross-chain not supported in this flow' };
    }

    if (!this.isSupportedChain(fromChain)) {
      return { eligible: false, reason: `Chain ${fromChain} not supported by Rhinestone` };
    }

    if (fromSymbol && !this.isSupportedToken(fromChain, fromSymbol)) {
      return { eligible: false, reason: `Token ${fromSymbol} not supported on ${fromChain}` };
    }

    if (toSymbol && !this.isSupportedToken(toChain, toSymbol)) {
      return { eligible: false, reason: `Token ${toSymbol} not supported on ${toChain}` };
    }

    return { eligible: true };
  }

  /**
   * Get companion wallet balance
   * Note: Full implementation would use SDK, this is a placeholder for the API pattern
   */
  async getCompanionBalance(
    companionAddress: string,
    chainId: number,
  ): Promise<{ eth: string; ethWei: string }> {
    const rpcUrl =
      chainId === 8453 ? 'https://mainnet.base.org' :
      chainId === 1 ? 'https://eth.llamarpc.com' :
      chainId === 10 ? 'https://mainnet.optimism.io' :
      chainId === 42161 ? 'https://arb1.arbitrum.io/rpc' :
      'https://mainnet.base.org';

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [companionAddress, 'latest'],
        id: 1,
      }),
    });

    const data = await res.json();
    const balanceWei = BigInt(data?.result || '0x0');
    const balanceEth = Number(balanceWei) / 1e18;

    return {
      eth: balanceEth.toFixed(8),
      ethWei: balanceWei.toString(),
    };
  }
}
