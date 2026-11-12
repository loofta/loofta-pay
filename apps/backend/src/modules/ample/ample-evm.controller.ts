import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { Public } from '@/common/guards/auth.guard';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { AmpleService } from './ample.service';
import { AmpleEvmService } from './ample-evm.service';
import { AmpleFundService } from './ample-fund.service';
import { AmpleEvmClaimDto, AmpleFundBroadcastDto, AmpleFundPrepareDto, AmpleFundWithdrawDto } from './dto/ample.dto';

/**
 * Earn on Base: the larger USDC pool. The person never touches Base. Their Earn account (a backend-held smart account with
 * Rhinestone paying gas) holds the money, funded from and returned to their Solana wallet. See AmpleFundService.
 */
@ApiTags('ample-evm')
@Controller('ample/evm')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class AmpleEvmController {
  constructor(
    private readonly ample: AmpleService,
    private readonly evm: AmpleEvmService,
    private readonly fund: AmpleFundService,
  ) {}

  @Get('stats')
  @Public()
  @RateLimit(60, 60, 'ample-evm:stats')
  @ApiOperation({ summary: 'Public numbers for the Base USDC pool' })
  async stats() {
    if (!this.ample.isEnabled()) return null;
    return this.evm.stats();
  }

  @Get('status')
  @RateLimit(60, 60, 'ample-evm:status')
  status(@Req() req: any) {
    return this.evm.status(req.user!.id);
  }

  @Get('overview')
  @RateLimit(60, 60, 'ample-evm:overview')
  overview(@Req() req: any) {
    return this.evm.overview(req.user!.id);
  }

  // ---- add money: Solana USDC -> Earn account -> pool ----

  @Post('fund/prepare')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'ample-evm:fund-prepare')
  fundPrepare(@Req() req: any, @Body() dto: AmpleFundPrepareDto) {
    return this.fund.prepare(req.user!.id, dto);
  }

  @Post('fund/:id/tx')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'ample-evm:fund-tx')
  fundTx(@Req() req: any, @Param('id') id: string) {
    return this.fund.buildTx(id, req.user!.id);
  }

  @Post('fund/:id/broadcast')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'ample-evm:fund-broadcast')
  fundBroadcast(@Req() req: any, @Param('id') id: string, @Body() dto: AmpleFundBroadcastDto) {
    return this.fund.submit(id, req.user!.id, dto.transaction);
  }

  /** Progress of an add or a withdrawal. Also nudges the order along, so it moves even without the background job. */
  @Get('fund/:id/status')
  @RateLimit(120, 60, 'ample-evm:fund-status')
  fundStatus(@Req() req: any, @Param('id') id: string) {
    return this.fund.status(id, req.user!.id);
  }

  // ---- take money out: pool -> Earn account -> Solana wallet ----

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'ample-evm:withdraw')
  withdraw(@Req() req: any, @Body() dto: AmpleFundWithdrawDto) {
    return this.fund.startWithdraw(req.user!.id, dto);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'ample-evm:claim')
  claim(@Req() req: any, @Body() dto: AmpleEvmClaimDto) {
    return this.fund.claim(req.user!.id, dto.payoutIds);
  }
}
