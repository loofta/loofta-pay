import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { CronGuard } from '@/common/guards';
import { ClaimProcessorService, ProcessingResult } from './claim-processor.service';
import { LotteryProcessorService, LotteryProcessingResult } from './lottery-processor.service';
import { ClaimCompanionProcessorService, ClaimCompanionResult } from './claim-companion-processor.service';
import { SwapProcessorService, SwapProcessingResult } from './swap-processor.service';
@ApiTags('cron')
@Controller('cron')
export class CronController {
  constructor(
    private readonly claimProcessorService: ClaimProcessorService,
    private readonly lotteryProcessorService: LotteryProcessorService,
    private readonly claimCompanionProcessorService: ClaimCompanionProcessorService,
    private readonly swapProcessorService: SwapProcessorService,
  ) {}

  /**
   * Process Near Intents status checks
   */
  @Get('process-intents')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process Near Intents status checks' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processIntents(): Promise<{
    success: boolean;
    processed: number;
    results: ProcessingResult[];
  }> {
    const { processed, results } = await this.claimProcessorService.triggerProcessing();
    return { success: true, processed, results };
  }

  /**
   * Process lottery (companion wallet) payments
   */
  @Get('process-lottery')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process lottery companion wallet payments' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processLottery(): Promise<{
    success: boolean;
    processed: number;
    results: LotteryProcessingResult[];
  }> {
    const { processed, results } = await this.lotteryProcessorService.triggerProcessing();
    return { success: true, processed, results };
  }

  /**
   * Process two-hop claim companions (ETH → token)
   */
  @Get('process-claim-companions')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process two-hop claim companions' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processClaimCompanions(): Promise<{
    success: boolean;
    processed: number;
    results: ClaimCompanionResult[];
  }> {
    const { processed, results } = await this.claimCompanionProcessorService.triggerProcessing();
    return { success: true, processed, results };
  }

  /**
   * Process same-chain swaps (claims and organizations)
   */
  @Get('process-swaps')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process same-chain swaps' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processSwaps(): Promise<{
    success: boolean;
    processed: number;
    results: SwapProcessingResult[];
  }> {
    const { processed, results } = await this.swapProcessorService.triggerProcessing();
    return { success: true, processed, results };
  }

  /**
   * Process ALL pending operations
   */
  @Post('process-all')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process all pending operations' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processAll(): Promise<{
    success: boolean;
    timestamp: string;
    intents: { processed: number; results: ProcessingResult[] };
    lottery: { processed: number; results: LotteryProcessingResult[] };
    claimCompanions: { processed: number; results: ClaimCompanionResult[] };
    swaps: { processed: number; results: SwapProcessingResult[] };
  }> {
    const [intents, lottery, claimCompanions, swaps] = await Promise.all([
      this.claimProcessorService.triggerProcessing(),
      this.lotteryProcessorService.triggerProcessing(),
      this.claimCompanionProcessorService.triggerProcessing(),
      this.swapProcessorService.triggerProcessing(),
    ]);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      intents,
      lottery,
      claimCompanions,
      swaps,
    };
  }

  /**
   * Get processing status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get cron processing status' })
  @ApiResponse({ status: 200, description: 'Processing status' })
  getStatus(): { isProcessing: boolean } {
    return this.claimProcessorService.getProcessingStatus();
  }

  /**
   * Legacy alias for backwards compatibility
   */
  @Get('process-claims')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: '[Legacy] Alias for process-intents' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processClaims(): Promise<{
    success: boolean;
    processed: number;
    results: ProcessingResult[];
  }> {
    return this.processIntents();
  }
}
