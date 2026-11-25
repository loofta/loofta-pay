import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnerTreasuryService } from './partner-treasury.service';
import { ConfirmTreasuryTxDto, ProposeTreasuryConfigDto, ProposeTreasuryWithdrawDto } from './dto/partner-treasury.dto';

type Caller = { id: string };

/**
 * The partner's company wallet (a Squads multisig). Default-deny: every route needs a login, and the
 * service resolves the caller's membership and, for anything that moves money or changes signers,
 * checks their own wallet against the multisig on-chain. Transactions returned here are built by the
 * server and only ever signed by the member's own wallet.
 */
@ApiTags('partners')
@Controller('partners/:orgId/treasury')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnerTreasuryController {
  constructor(private readonly treasury: PartnerTreasuryService) {}

  @Get()
  @RateLimit(60, 60, 'partners:treasury-state')
  state(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.treasury.state(orgId, user.id);
  }

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @RateLimit(3, 300, 'partners:treasury-create')
  create(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.treasury.create(orgId, user.id);
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:treasury-config')
  propose(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: ProposeTreasuryConfigDto) {
    return this.treasury.proposeConfig(orgId, user.id, dto);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 300, 'partners:treasury-withdraw')
  withdraw(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: ProposeTreasuryWithdrawDto) {
    return this.treasury.proposeWithdraw(orgId, user.id, dto);
  }

  @Post('batches/:batchId/proposal')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:treasury-payout-proposal')
  payoutProposal(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.treasury.buildPayoutProposal(orgId, user.id, batchId);
  }

  @Post('proposals/:proposalId/approve')
  @HttpCode(HttpStatus.OK)
  @RateLimit(30, 60, 'partners:treasury-approve')
  approve(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.treasury.buildVote(orgId, user.id, proposalId, 'approve');
  }

  @Post('proposals/:proposalId/reject')
  @HttpCode(HttpStatus.OK)
  @RateLimit(30, 60, 'partners:treasury-reject')
  reject(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.treasury.buildVote(orgId, user.id, proposalId, 'reject');
  }

  @Post('proposals/:proposalId/execute')
  @HttpCode(HttpStatus.OK)
  @RateLimit(30, 60, 'partners:treasury-execute')
  execute(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.treasury.buildExecute(orgId, user.id, proposalId);
  }

  @Post('proposals/:proposalId/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit(60, 60, 'partners:treasury-confirm')
  confirm(
    @PrivyUser() user: Caller,
    @Param('orgId') orgId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: ConfirmTreasuryTxDto,
  ) {
    return this.treasury.confirm(orgId, user.id, proposalId, dto.signature);
  }
}
