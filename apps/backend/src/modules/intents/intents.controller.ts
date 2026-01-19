import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { NearIntentsService, NearToken, QuoteResult } from './near-intents.service';
import { StatusService, UnifiedStatus } from './status.service';
import { RhinestoneService } from './rhinestone.service';

class GetQuoteDto {
  fromTokenId: string;
  fromChain: string;
  fromDecimals: number;
  toTokenId: string;
  toChain: string;
  toDecimals: number;
  amount: string;
  slippageBps?: number;
}

@ApiTags('intents')
@Controller('intents')
export class IntentsController {
  constructor(
    private readonly nearIntentsService: NearIntentsService,
    private readonly statusService: StatusService,
    private readonly rhinestoneService: RhinestoneService,
  ) {}

  /**
   * Get swap quote
   */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get swap quote (dry run)' })
  @ApiResponse({
    status: 200,
    description: 'Quote result',
    schema: {
      properties: {
        amountOut: { type: 'string' },
        error: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  })
  async getQuote(@Body() dto: GetQuoteDto): Promise<QuoteResult> {
    return this.nearIntentsService.getDryQuote({
      fromToken: {
        tokenId: dto.fromTokenId,
        chain: dto.fromChain,
        decimals: dto.fromDecimals,
      },
      toToken: {
        tokenId: dto.toTokenId,
        chain: dto.toChain,
        decimals: dto.toDecimals,
      },
      amount: dto.amount,
      slippageBps: dto.slippageBps,
    });
  }

  /**
   * Get transaction status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get transaction/intent status' })
  @ApiQuery({ name: 'depositAddress', required: false, description: 'Near Intents deposit address' })
  @ApiQuery({ name: 'rhinestoneId', required: false, description: 'Rhinestone intent ID' })
  @ApiResponse({ status: 200, description: 'Status result' })
  async getStatus(
    @Query('depositAddress') depositAddress?: string,
    @Query('rhinestoneId') rhinestoneId?: string,
  ): Promise<UnifiedStatus> {
    return this.statusService.getStatus({
      depositAddress,
      rhinestoneId,
    });
  }

  /**
   * Check Rhinestone eligibility
   */
  @Get('rhinestone/eligibility')
  @ApiOperation({ summary: 'Check if swap can use Rhinestone' })
  @ApiQuery({ name: 'fromChain', required: true })
  @ApiQuery({ name: 'toChain', required: true })
  @ApiQuery({ name: 'fromSymbol', required: false })
  @ApiQuery({ name: 'toSymbol', required: false })
  @ApiResponse({ status: 200, description: 'Eligibility result' })
  checkRhinestoneEligibility(
    @Query('fromChain') fromChain: string,
    @Query('toChain') toChain: string,
    @Query('fromSymbol') fromSymbol?: string,
    @Query('toSymbol') toSymbol?: string,
  ): { eligible: boolean; reason?: string } {
    return this.rhinestoneService.canUseRhinestone({
      fromChain,
      toChain,
      fromSymbol,
      toSymbol,
    });
  }

  /**
   * Get supported Rhinestone chains
   */
  @Get('rhinestone/chains')
  @ApiOperation({ summary: 'Get Rhinestone supported chains' })
  @ApiResponse({ status: 200, description: 'List of supported chain IDs' })
  getRhinestoneChains(): { chainIds: number[] } {
    return { chainIds: this.rhinestoneService.getActiveChainIds() };
  }
}
