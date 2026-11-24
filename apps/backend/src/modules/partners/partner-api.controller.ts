import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { CreatePartnerBatchDto } from './dto/partner-batch.dto';
import { SetWebhookDto, SetWithdrawOptionsDto, UserQueryDto } from './dto/partner.dto';
import { PartnerKeysService } from './partner-keys.service';
import { PartnerPayoutsService } from './partner-payouts.service';
import { PartnersService } from './partners.service';

/**
 * Bulk payouts from the partner's own platform. The partner's server drafts a batch with its API key
 * and sends its admin to `approve_url`. A key can never move money: the batch waits for a signed-in
 * owner or admin, and the company wallet's signers still have to sign before a single payout leaves.
 * Needs the "payout batches" switch to be on for the partner (Developers tab), off by default.
 */
@ApiTags('partner-api')
@Controller('partner-api')
@UseGuards(IntegratorGuard, RateLimitGuard)
@ApiSecurity('integrator-key')
export class PartnerApiController {
  constructor(
    private readonly payouts: PartnerPayoutsService,
    private readonly partners: PartnersService,
    private readonly config: ConfigService,
    private readonly keys: PartnerKeysService,
  ) {}

  private approveUrl(orgId: string, batchId: string) {
    const base = this.config.get<string>('PAY_APP_URL') || 'https://pay.loofta.com';
    return `${base.replace(/\/$/, '')}/app/partner?org=${encodeURIComponent(orgId)}&tab=payouts&batch=${encodeURIComponent(batchId)}`;
  }

  /**
   * What a partner's server gets back. Only what it needs to show progress: no internal user ids, wallet addresses
   * or approval hashes, which the portal uses but an API key has no business reading.
   */
  private async shape(integratorId: string, batch: Record<string, unknown> & { id: string }) {
    const orgId = await this.partners.orgIdForIntegrator(integratorId);
    const items = (batch.items as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      batch_id: batch.id,
      status: batch.status,
      label: batch.label ?? null,
      item_count: batch.item_count,
      failed_count: batch.failed_count,
      total_amount: batch.total_amount,
      created_at: batch.created_at,
      scheduled_for: batch.scheduled_for ?? null,
      scheduled_error: batch.scheduled_error ?? null,
      approve_url: this.approveUrl(orgId, batch.id),
      items: items.map((i) => ({
        row_index: i.row_index,
        recipient_identifier: i.recipient_identifier,
        amount: i.amount,
        external_ref: i.external_ref ?? null,
        status: i.status,
        error: i.error ?? null,
        withdrawn: Boolean(i.withdrawn),
      })),
    };
  }

  @Post('batches')
  @HttpCode(HttpStatus.OK)
  @RequireScope('batches:write')
  @RateLimit(60, 60, 'partner-api:batches', 'integrator')
  @ApiOperation({ summary: 'Draft a payout batch (email recipients). It waits for your team to approve and fund it from the company wallet.' })
  async create(@Body() dto: CreatePartnerBatchDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const batch = await this.payouts.createDraftViaApi(req.integrator.id, dto);
    return this.shape(req.integrator.id, batch);
  }

  @Get('batches/:batchId')
  @RequireScope('batches:write')
  @RateLimit(240, 60, 'partner-api:batch-get', 'integrator')
  @ApiOperation({ summary: 'Status of a batch and each payout in it' })
  async get(@Param('batchId', new ParseUUIDPipe()) batchId: string, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const batch = await this.payouts.getViaApi(req.integrator.id, batchId);
    return this.shape(req.integrator.id, batch);
  }

  @Get('batches')
  @RequireScope('batches:write')
  @RateLimit(120, 60, 'partner-api:batch-list', 'integrator')
  @ApiOperation({ summary: 'Your most recent batches, newest first' })
  async list(@Query('limit') limit: string | undefined, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const rows = await this.payouts.listViaApi(req.integrator.id, Number(limit) || 25);
    const orgId = await this.partners.orgIdForIntegrator(req.integrator.id);
    return {
      batches: rows.map((b: Record<string, unknown>) => ({
        batch_id: b.id, status: b.status, label: b.label ?? null, item_count: b.item_count, failed_count: b.failed_count,
        total_amount: b.total_amount, created_at: b.created_at, scheduled_for: b.scheduled_for ?? null,
        approve_url: this.approveUrl(orgId, String(b.id)),
      })),
    };
  }

  @Post('batches/:batchId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScope('batches:write')
  @RateLimit(60, 60, 'partner-api:batch-cancel', 'integrator')
  @ApiOperation({ summary: 'Call off a batch that is still waiting for approval, or approved and not yet prepared' })
  async cancel(@Param('batchId', new ParseUUIDPipe()) batchId: string, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const batch = await this.payouts.cancelViaApi(req.integrator.id, batchId);
    return this.shape(req.integrator.id, batch);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @RequireScope('batches:write')
  @RateLimit(10, 60, 'partner-api:webhook', 'integrator')
  @ApiOperation({ summary: 'Set (or clear with null) the https URL that receives signed payout and batch events. Returns the signing secret.' })
  async setWebhook(@Body() dto: SetWebhookDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.keys.setWebhookForIntegrator(req.integrator.id, dto.url ?? null);
  }

  @Get('users/balance')
  @RequireScope('portal:token')
  @RateLimit(240, 60, 'partner-api:user-balance', 'integrator')
  @ApiOperation({ summary: 'What one of your users can withdraw now, and what they already withdrew. Pass an email, a platform and handle, or your own external_user_id.' })
  async userBalance(@Query() query: UserQueryDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.payouts.userBalanceViaApi(req.integrator.id, query);
  }

  @Get('users/history')
  @RequireScope('portal:token')
  @RateLimit(240, 60, 'partner-api:user-history', 'integrator')
  @ApiOperation({ summary: 'One page of the payouts a user received from you, newest first. page starts at 1, limit is 1 to 100.' })
  async userHistory(@Query() query: UserQueryDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.payouts.userHistoryViaApi(req.integrator.id, query);
  }

  @Get('withdraw-options')
  @RequireScope('batches:write')
  @RateLimit(60, 60, 'partner-api:withdraw-options-get', 'integrator')
  @ApiOperation({ summary: 'Which cash-out routes and history your recipients see on the withdraw page' })
  async getWithdrawOptions(@Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.partners.withdrawOptionsForIntegrator(req.integrator.id);
  }

  @Post('withdraw-options')
  @HttpCode(HttpStatus.OK)
  @RequireScope('batches:write')
  @RateLimit(20, 60, 'partner-api:withdraw-options-set', 'integrator')
  @ApiOperation({ summary: 'Show or hide payout history and switch cash-out routes (usdc, token, bank, p2p) on or off' })
  async setWithdrawOptions(@Body() dto: SetWithdrawOptionsDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.partners.withdrawOptionsForIntegrator(req.integrator.id, dto);
  }
}
