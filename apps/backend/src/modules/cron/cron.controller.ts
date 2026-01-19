import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { CronGuard } from '@/common/guards';
import { ClaimProcessorService, ProcessingResult } from './claim-processor.service';

@ApiTags('cron')
@Controller('cron')
export class CronController {
  constructor(private readonly claimProcessorService: ClaimProcessorService) {}

  /**
   * Manually trigger claim processing
   */
  @Get('process-claims')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Trigger claim processing (cron endpoint)' })
  @ApiResponse({
    status: 200,
    description: 'Processing results',
    schema: {
      properties: {
        success: { type: 'boolean' },
        processed: { type: 'number' },
        results: { type: 'array' },
      },
    },
  })
  async processClaims(): Promise<{
    success: boolean;
    processed: number;
    results: ProcessingResult[];
  }> {
    const { processed, results } = await this.claimProcessorService.triggerProcessing();
    return {
      success: true,
      processed,
      results,
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
   * Process all pending - alias for backwards compatibility
   */
  @Post('process-all')
  @UseGuards(CronGuard)
  @ApiSecurity('Bearer')
  @ApiOperation({ summary: 'Process all pending claims' })
  @ApiResponse({ status: 200, description: 'Processing results' })
  async processAll(): Promise<{
    success: boolean;
    processed: number;
    results: ProcessingResult[];
  }> {
    return this.processClaims();
  }
}
