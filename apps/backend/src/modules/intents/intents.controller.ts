import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { AuthGuard } from '@/common/guards';
import { NearIntentsService, NearToken, QuoteResult } from './near-intents.service';
import { StatusService, UnifiedStatus } from './status.service';

export class GetQuoteDto {
  @IsString()
  @IsNotEmpty()
  fromTokenId: string;

  @IsString()
  @IsNotEmpty()
  fromChain: string;

  @IsNumber()
  fromDecimals: number;

  @IsString()
  @IsNotEmpty()
  toTokenId: string;

  @IsString()
  @IsNotEmpty()
  toChain: string;

  @IsNumber()
  toDecimals: number;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsOptional()
  @IsNumber()
  slippageBps?: number;
}

export class CreateWithdrawalOrderDto {
  @IsString()
  @IsNotEmpty()
  fromTokenId: string;

  @IsString()
  @IsNotEmpty()
  fromChain: string;

  @IsString()
  @IsNotEmpty()
  fromSymbol: string;

  @IsNumber()
  fromDecimals: number;

  @IsString()
  @IsNotEmpty()
  toTokenId: string;

  @IsString()
  @IsNotEmpty()
  toChain: string;

  @IsString()
  @IsNotEmpty()
  toSymbol: string;

  @IsNumber()
  toDecimals: number;

  @IsString()
  @IsNotEmpty()
  amountUsdc: string;

  @IsString()
  @IsNotEmpty()
  destinationAddress: string;

  @IsString()
  @IsNotEmpty()
  refundAddress: string;

  @IsOptional()
  @IsBoolean()
  isDevnet?: boolean;
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
   * Creates a real, backend-tracked withdrawal order BEFORE the user signs anything: fetches the
   * NEAR deposit quote server-side and persists the expected deposit address, so
   * solana-sponsor.service.ts can later verify the ATA it's about to sponsor actually matches this
   * order — instead of the client fetching the quote directly from NEAR and handing us an
   * unverified destination (see project memory: solana sponsor security hardening). Pass the
   * returned `id` as `nearIntentsOrderId` to the sign-and-broadcast call.
   */
  @Post('withdraw/prepare')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create a backend-tracked Near Intents withdrawal order (quote + persisted deposit address)' })
  async prepareWithdrawal(
    @Req() req: { user?: { id: string } },
    @Body() dto: CreateWithdrawalOrderDto,
  ) {
    return this.nearIntentsService.createWithdrawalOrder({
      userId: req.user!.id,
      fromToken: { tokenId: dto.fromTokenId, chain: dto.fromChain, symbol: dto.fromSymbol, decimals: dto.fromDecimals },
      toToken: { tokenId: dto.toTokenId, chain: dto.toChain, symbol: dto.toSymbol, decimals: dto.toDecimals },
      amountUsdc: dto.amountUsdc,
      destinationAddress: dto.destinationAddress,
      refundAddress: dto.refundAddress,
      isDevnet: dto.isDevnet,
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
