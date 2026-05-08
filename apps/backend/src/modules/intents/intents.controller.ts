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
  @ApiResponse({ status: 200, description: 'Status result' })
  async getStatus(
    @Query('depositAddress') depositAddress?: string,
  ): Promise<UnifiedStatus> {
    return this.statusService.getStatus({ depositAddress });
  }

}
