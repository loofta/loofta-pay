import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/guards';
import { StageKey } from './memecoin-filters';
import { MemecoinTerminalService } from './memecoin-terminal.service';

const STAGES: StageKey[] = ['new', 'final', 'grad'];

@ApiTags('memecoin')
@Controller('memecoin')
export class MemecoinTerminalController {
  constructor(private readonly service: MemecoinTerminalService) {}

  @Public()
  @Get('feed')
  @ApiOperation({ summary: 'Pre-filtered feed of coins that graduated from Pump.fun' })
  feed(
    @Query('safe') safe?: string,
    @Query('stage') stage?: string,
    @Query('low') low?: string,
    @Query('story') story?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Number(limit);
    return this.service.feed({
      safe: safe !== 'false',
      stage: STAGES.includes(stage as StageKey) ? (stage as StageKey) : undefined,
      lowRiskOnly: low === 'true',
      story: story && /^[a-z:0-9_-]{1,40}$/.test(story) ? story : undefined,
      limit: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 50,
    });
  }

  @Public()
  @Get('stories')
  @ApiOperation({ summary: 'Hottest narratives among recently graduated coins' })
  stories() {
    return this.service.stories();
  }

  @Public()
  @Get('token/:mint')
  @ApiOperation({ summary: 'One coin with its checks and a plain-language risk summary' })
  detail(@Param('mint') mint: string) {
    return this.service.detail(mint);
  }
}
