import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { Public } from '@/common/guards/auth.guard';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { UsersService } from '@/modules/users/users.service';
import { AmpleService } from './ample.service';
import { AmpleAmountDto, AmpleChallengeDto, AmpleClaimDto, AmpleLinkDto } from './dto/ample.dto';

@ApiTags('ample')
@Controller('ample')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class AmpleController {
  constructor(
    private readonly ample: AmpleService,
    private readonly users: UsersService,
  ) {}

  /** The wallet being linked must be one of the caller's own, or anyone could attach a stranger's wallet to their account. */
  private async assertOwnWallet(userId: string, address: string) {
    if (!(await this.users.isSolanaAddressInLinkedAccounts(userId, address))) {
      throw new ForbiddenException('walletAddress must be one of your own linked wallets');
    }
  }

  @Get('stats')
  @Public()
  @RateLimit(60, 60, 'ample:stats')
  @ApiOperation({ summary: 'Public staking numbers for the home card and marketing page' })
  async stats() {
    if (!this.ample.isEnabled()) return null;
    return this.ample.publicStats();
  }

  @Get('status')
  @RateLimit(60, 60, 'ample:status')
  @ApiOperation({ summary: 'Is staking on, is the caller linked, and the Solana vaults on offer' })
  async status(@Req() req: any) {
    if (!this.ample.isEnabled()) return { enabled: false, canTransact: false, linked: false, vaults: [] };
    const [link, vaults] = await Promise.all([this.ample.getLink(req.user!.id), this.ample.listVaults()]);
    return { enabled: true, canTransact: this.ample.canBuildTransactions(), ...link, vaults };
  }

  @Post('link/challenge')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'ample:challenge')
  async challenge(@Req() req: any, @Body() dto: AmpleChallengeDto) {
    await this.assertOwnWallet(req.user!.id, dto.walletAddress);
    return this.ample.challenge(req.user!.id, dto.walletAddress);
  }

  @Post('link')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'ample:link')
  async link(@Req() req: any, @Body() dto: AmpleLinkDto) {
    await this.assertOwnWallet(req.user!.id, dto.walletAddress);
    return this.ample.link(req.user!.id, dto.walletAddress, dto.message, dto.signature);
  }

  @Get('overview')
  @RateLimit(60, 60, 'ample:overview')
  overview(@Req() req: any) {
    return this.ample.overview(req.user!.id);
  }

  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'ample:deposit')
  deposit(@Req() req: any, @Body() dto: AmpleAmountDto) {
    return this.ample.buildDeposit(req.user!.id, dto.vaultId, dto.amount);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'ample:withdraw')
  withdraw(@Req() req: any, @Body() dto: AmpleAmountDto) {
    return this.ample.buildWithdraw(req.user!.id, dto.vaultId, dto.amount);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'ample:claim')
  claim(@Req() req: any, @Body() dto: AmpleClaimDto) {
    return this.ample.buildClaim(req.user!.id, dto.payoutId);
  }

  @Get('tx/:hash/status')
  @RateLimit(120, 60, 'ample:txstatus')
  txStatus(@Req() req: any, @Param('hash') hash: string) {
    return this.ample.txStatus(req.user!.id, hash.slice(0, 120));
  }
}
