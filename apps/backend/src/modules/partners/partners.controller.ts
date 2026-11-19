import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Public, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnersService } from './partners.service';
import { PartnerKeysService } from './partner-keys.service';
import {
  AcceptInviteDto,
  ChangeRoleDto,
  CreatePartnerDto,
  ImportRecipientsDto,
  InviteMemberDto,
  SetApiAccessDto,
  UpdatePartnerDto,
  UpdatePartnerSettingsDto,
} from './dto/partner.dto';

type Caller = { id: string };

/**
 * Partner portal API. Default-deny: every route needs a verified login unless marked @Public().
 * Every :orgId route resolves the caller's membership and role inside the service, so passing
 * another org's id returns "not found", never data.
 */
@ApiTags('partners')
@Controller('partners')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly keys: PartnerKeysService,
  ) {}

  /** Public: what the withdraw page and the widget need to brand themselves and show the fees. */
  @Get('public/:orgId')
  @Public()
  @RateLimit(120, 60, 'partners:public')
  @ApiOperation({ summary: 'Public partner branding and withdrawal fees by orgId' })
  publicInfo(@Param('orgId') orgId: string) {
    return this.partners.findPublicByOrgId(orgId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(5, 60, 'partners:create')
  create(@PrivyUser() user: Caller, @Body() dto: CreatePartnerDto) {
    return this.partners.create(user.id, dto);
  }

  @Get('mine')
  @RateLimit(60, 60, 'partners:mine')
  async mine(@PrivyUser() user: Caller) {
    return { partners: await this.partners.listMine(user.id) };
  }

  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:invite-accept')
  acceptInvite(@PrivyUser() user: Caller, @Body() dto: AcceptInviteDto) {
    return this.partners.acceptInvite(user.id, dto.token);
  }

  @Get(':orgId')
  @RateLimit(60, 60, 'partners:get')
  get(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.partners.getSettings(orgId, user.id);
  }

  @Patch(':orgId')
  @RateLimit(30, 60, 'partners:update')
  update(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(orgId, user.id, dto);
  }

  @Patch(':orgId/settings')
  @RateLimit(30, 60, 'partners:settings')
  @ApiOperation({ summary: 'Withdrawal settings: minimum, fixed fee, percent fee. Owner-only: fee wallet, approval threshold.' })
  updateSettings(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: UpdatePartnerSettingsDto) {
    return this.partners.updateSettings(orgId, user.id, dto);
  }

  @Post(':orgId/settings/cancel-fee-wallet-change')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:cancel-fee-wallet')
  cancelFeeWalletChange(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.partners.cancelFeeWalletChange(orgId, user.id);
  }

  // ---- team

  @Get(':orgId/members')
  @RateLimit(60, 60, 'partners:members')
  async members(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return { members: await this.partners.listMembers(orgId, user.id) };
  }

  @Post(':orgId/members/invite')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(10, 60, 'partners:invite')
  invite(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: InviteMemberDto) {
    return this.partners.invite(orgId, user.id, dto.email, dto.role);
  }

  @Patch(':orgId/members/:memberId')
  @RateLimit(20, 60, 'partners:member-role')
  async changeRole(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('memberId') memberId: string, @Body() dto: ChangeRoleDto) {
    await this.partners.changeRole(orgId, user.id, memberId, dto.role);
    return { ok: true };
  }

  @Delete(':orgId/members/:memberId')
  @RateLimit(20, 60, 'partners:member-remove')
  async removeMember(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    await this.partners.removeMember(orgId, user.id, memberId);
    return { ok: true };
  }

  @Delete(':orgId/invites/:memberId')
  @RateLimit(20, 60, 'partners:invite-revoke')
  async revokeInvite(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    await this.partners.revokeInvite(orgId, user.id, memberId);
    return { ok: true };
  }

  @Get(':orgId/api-keys')
  @RateLimit(30, 60, 'partners:keys-list')
  listKeys(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.keys.list(orgId, user.id);
  }

  @Post(':orgId/api-keys')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(5, 60, 'partners:keys-create')
  createKey(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.keys.create(orgId, user.id);
  }

  @Get(':orgId/api-access')
  @RateLimit(30, 60, 'partners:api-access-get')
  getApiAccess(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.keys.getApiAccess(orgId, user.id);
  }

  @Post(':orgId/api-access')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:api-access-set')
  setApiAccess(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: SetApiAccessDto) {
    return this.keys.setApiAccess(orgId, user.id, dto.payout_batches);
  }

  @Delete(':orgId/api-keys/:keyId')
  @RateLimit(10, 60, 'partners:keys-revoke')
  revokeKey(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('keyId') keyId: string) {
    return this.keys.revoke(orgId, user.id, keyId);
  }

  @Get(':orgId/audit')
  @RateLimit(30, 60, 'partners:audit')
  async audit(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Query('limit') limit?: string) {
    return { events: await this.partners.listAudit(orgId, user.id, Number(limit) || 100) };
  }

  // ---- recipients

  @Post(':orgId/recipients/import')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:import')
  @ApiOperation({ summary: 'Import recipients (email or social handle, name, metadata). CSV is parsed in the portal.' })
  importRecipients(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: ImportRecipientsDto) {
    return this.partners.importRecipients(orgId, user.id, dto.recipients);
  }

  @Get(':orgId/recipients')
  @RateLimit(60, 60, 'partners:recipients')
  async recipients(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return { recipients: await this.partners.listRecipients(orgId, user.id, Number(limit) || 200, Number(offset) || 0) };
  }

  @Get(':orgId/recipients/lookup')
  @RateLimit(120, 60, 'partners:lookup')
  lookup(
    @PrivyUser() user: Caller,
    @Param('orgId') orgId: string,
    @Query('external_user_id') externalUserId?: string,
    @Query('email') email?: string,
    @Query('handle') handle?: string,
    @Query('platform') platform?: string,
  ) {
    return this.partners.lookupRecipient(orgId, user.id, { externalUserId, email, handle, platform });
  }
}
