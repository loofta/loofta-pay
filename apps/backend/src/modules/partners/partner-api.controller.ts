import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { CreatePartnerBatchDto } from './dto/partner-batch.dto';
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
  ) {}

  private approveUrl(orgId: string, batchId: string) {
    const base = this.config.get<string>('PAY_APP_URL') || 'https://pay.loofta.xyz';
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
}
