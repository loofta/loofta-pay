import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TokensService } from './tokens.service';
import { NearToken } from '../intents/near-intents.service';

@ApiTags('tokens')
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  /**
   * Get all tokens
   */
  @Get()
  @ApiOperation({ summary: 'Get all available tokens' })
  @ApiResponse({ status: 200, description: 'List of tokens' })
  async getTokens(): Promise<{ tokens: NearToken[] }> {
    const tokens = await this.tokensService.getTokens();
    return { tokens };
  }

  /**
   * Search tokens
   */
  @Get('search')
  @ApiOperation({ summary: 'Search tokens by query' })
  @ApiQuery({ name: 'q', description: 'Search query (symbol, name, or chain)' })
  @ApiResponse({ status: 200, description: 'Matching tokens' })
  async searchTokens(@Query('q') query: string): Promise<{ tokens: NearToken[] }> {
    const tokens = await this.tokensService.searchTokens(query);
    return { tokens };
  }

  /**
   * Get tokens by chain
   */
  @Get('by-chain')
  @ApiOperation({ summary: 'Get tokens for a specific chain' })
  @ApiQuery({ name: 'chain', description: 'Chain name (e.g., eth, base, arb)' })
  @ApiResponse({ status: 200, description: 'Tokens on the specified chain' })
  async getTokensByChain(@Query('chain') chain: string): Promise<{ tokens: NearToken[] }> {
    const tokens = await this.tokensService.getTokensByChain(chain);
    return { tokens };
  }

  /**
   * Get popular tokens
   */
  @Get('popular')
  @ApiOperation({ summary: 'Get popular tokens for quick selection' })
  @ApiResponse({ status: 200, description: 'Popular tokens' })
  async getPopularTokens(): Promise<{ tokens: NearToken[] }> {
    const tokens = await this.tokensService.getPopularTokens();
    return { tokens };
  }

  /**
   * Get stablecoins
   */
  @Get('stablecoins')
  @ApiOperation({ summary: 'Get stablecoin tokens' })
  @ApiResponse({ status: 200, description: 'Stablecoin tokens' })
  async getStablecoins(): Promise<{ tokens: NearToken[] }> {
    const tokens = await this.tokensService.getStablecoins();
    return { tokens };
  }

  /**
   * Get token price
   */
  @Get('price')
  @ApiOperation({ summary: 'Get token price' })
  @ApiQuery({ name: 'symbol', description: 'Token symbol' })
  @ApiQuery({ name: 'chain', description: 'Chain name' })
  @ApiResponse({ status: 200, description: 'Token price' })
  async getTokenPrice(
    @Query('symbol') symbol: string,
    @Query('chain') chain: string,
  ): Promise<{ price: number | null }> {
    const price = await this.tokensService.getTokenPrice(symbol, chain);
    return { price: price ?? null };
  }
}
