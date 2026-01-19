import { Injectable, Logger } from '@nestjs/common';
import { NearIntentsService, NearToken } from '../intents/near-intents.service';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(private readonly nearIntentsService: NearIntentsService) {}

  /**
   * Get all available tokens
   */
  async getTokens(): Promise<NearToken[]> {
    return this.nearIntentsService.getTokens();
  }

  /**
   * Search tokens by query
   */
  async searchTokens(query: string): Promise<NearToken[]> {
    return this.nearIntentsService.searchTokens(query);
  }

  /**
   * Get token by symbol and chain
   */
  async getToken(symbol: string, chain: string): Promise<NearToken | null> {
    const tokens = await this.nearIntentsService.getTokens();
    return (
      tokens.find(
        (t) =>
          t.symbol.toUpperCase() === symbol.toUpperCase() &&
          t.chain.toLowerCase() === chain.toLowerCase(),
      ) || null
    );
  }

  /**
   * Get tokens for a specific chain
   */
  async getTokensByChain(chain: string): Promise<NearToken[]> {
    const tokens = await this.nearIntentsService.getTokens();
    return tokens.filter((t) => t.chain.toLowerCase() === chain.toLowerCase());
  }

  /**
   * Get token price
   */
  async getTokenPrice(symbol: string, chain: string): Promise<number | undefined> {
    return this.nearIntentsService.getTokenPrice(symbol, chain);
  }

  /**
   * Get popular tokens (for quick selection)
   */
  async getPopularTokens(): Promise<NearToken[]> {
    const tokens = await this.nearIntentsService.getTokens();
    const popularSymbols = ['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'WBTC'];
    const popularChains = ['eth', 'base', 'arb', 'op', 'polygon'];

    return tokens.filter(
      (t) =>
        popularSymbols.includes(t.symbol.toUpperCase()) &&
        popularChains.includes(t.chain.toLowerCase()),
    );
  }

  /**
   * Get stablecoins
   */
  async getStablecoins(): Promise<NearToken[]> {
    const tokens = await this.nearIntentsService.getTokens();
    const stableSymbols = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX'];

    return tokens.filter((t) =>
      stableSymbols.includes(t.symbol.toUpperCase()),
    );
  }
}
