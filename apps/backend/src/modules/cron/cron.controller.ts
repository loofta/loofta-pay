import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { CronGuard } from '@/common/guards';
import { ClaimProcessorService, ProcessingResult } from './claim-processor.service';
import { SwapProcessorService, SwapProcessingResult } from './swap-processor.service';
import { SolanaTxVerifierService, TxVerifierResult } from './solana-tx-verifier.service';

@ApiTags('cron')
@Controller('cron')
export class CronController {
  constructor(
    private readonly claimProcessorService: ClaimProcessorService,
    private readonly swapProcessorService: SwapProcessorService,
    private readonly solanaTxVerifierService: SolanaTxVerifierService,
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
    skipped?: boolean;
  }> {
    const { processed, results, skipped } = await this.claimProcessorService.triggerProcessing();
    return { success: true, processed, results, skipped };
  }

  /**
   * Process two-hop claim companions (ETH → token)
   */
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
   * Verify PRIVATE_TRANSFER_PENDING claims that have a saved sender_tx_hash against the Solana RPC.
   * Upgrades to SUCCESS if the tx is confirmed on-chain.
   */
  @Get('verify-solana-txs')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Verify pending Solana tx hashes and upgrade confirmed claims to SUCCESS' })
  @ApiResponse({ status: 200, description: 'Verification results' })
  async verifySolanaTxs(): Promise<{
    success: boolean;
    processed: number;
    results: TxVerifierResult[];
  }> {
    const { processed, results } = await this.solanaTxVerifierService.triggerProcessing();
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
    intents: { processed: number; results: ProcessingResult[]; skipped?: boolean };
    swaps: { processed: number; results: SwapProcessingResult[] };
    solanaTxs: { processed: number; results: TxVerifierResult[] };
  }> {
    const [intents, swaps, solanaTxs] = await Promise.all([
      this.claimProcessorService.triggerProcessing(),
      this.swapProcessorService.triggerProcessing(),
      this.solanaTxVerifierService.triggerProcessing(),
    ]);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      intents,
      swaps,
      solanaTxs,
    };
  }

  @Get('status')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
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
    skipped?: boolean;
  }> {
    return this.processIntents();
  }
}
