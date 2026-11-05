import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClaimsService } from '@/modules/claims/claims.service';
import { SupabaseService } from '@/database/supabase.service';
import { PortalSession, PortalTokenService } from './portal-token.service';

class WithdrawDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  destination_address: string;

  /** Optional: withdraw just this payout. Omitted = withdraw everything available. */
  @IsOptional()
  @IsString()
  payment_id?: string;
}

@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly tokens: PortalTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; portal?: PortalSession }>();
    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Missing portal token.');
    req.portal = this.tokens.verify(header.slice(7).trim());
    return true;
  }
}

/**
 * What the embedded portal calls. Everything is scoped by the recipient id inside the verified
 * token, never by anything in the request, so one end user can only ever see their own payouts.
 */
@ApiTags('partner-portal')
@Controller('portal')
@UseGuards(PortalGuard)
export class PortalController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly claims: ClaimsService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Balance, unclaimed payouts and history for the recipient in the portal token' })
  async me(@Req() req: { portal: PortalSession }) {
    const { recipientId, integratorId } = req.portal;

    const [{ data: recipient }, { data: integrator }, { data: settings }, { data: payments }] = await Promise.all([
      this.supabase.partnerRecipients.select('display_name').eq('id', recipientId).maybeSingle(),
      this.supabase.integrators.select('name, organization_id').eq('id', integratorId).maybeSingle(),
      this.supabase.partnerSettings.select('allowed_withdrawal_methods, default_withdrawal_method').eq('integrator_id', integratorId).maybeSingle(),
      this.supabase.payments
        .select('id, amount, status, description, created_at, recipient_address, claim_requested_destination, sender_tx_hash')
        .eq('partner_recipient_id', recipientId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    let brand: { name: string | null; logo_url: string | null } = { name: integrator?.name ?? null, logo_url: null };
    if (integrator?.organization_id) {
      const { data: org } = await this.supabase.organizations.select('name, logo_url').eq('id', integrator.organization_id).maybeSingle();
      if (org) brand = { name: org.name ?? brand.name, logo_url: org.logo_url ?? null };
    }

    const history = (payments ?? []).map((p) => {
      const withdrawn = !String(p.recipient_address ?? '').startsWith(ClaimsServicePendingPartner);
      const funded = ['SUCCESS', 'PRIVATE_TRANSFER_PENDING'].includes(String(p.status).toUpperCase());
      return {
        payment_id: p.id,
        amount: Number(p.amount),
        message: p.description ?? null,
        created_at: p.created_at,
        state: withdrawn ? 'withdrawn' : funded ? 'available' : 'processing',
        withdrawn_to: withdrawn ? p.claim_requested_destination ?? null : null,
      };
    });

    return {
      partner: brand,
      recipient: { display_name: recipient?.display_name ?? null },
      return_url: req.portal.returnUrl ?? null,
      available_usd: history.filter((h) => h.state === 'available').reduce((a, h) => a + h.amount, 0),
      processing_usd: history.filter((h) => h.state === 'processing').reduce((a, h) => a + h.amount, 0),
      withdrawal_methods: settings?.allowed_withdrawal_methods ?? ['usdc_wallet'],
      history,
    };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw available payouts (USDC on Solana) to the wallet address the recipient provides' })
  async withdraw(@Body() dto: WithdrawDto, @Req() req: { portal: PortalSession }) {
    const { recipientId } = req.portal;
    let query = this.supabase.payments
      .select('id, status, recipient_address')
      .eq('partner_recipient_id', recipientId)
      .like('recipient_address', `${ClaimsServicePendingPartner}%`)
      .in('status', ['SUCCESS', 'PRIVATE_TRANSFER_PENDING']);
    if (dto.payment_id) query = query.eq('id', dto.payment_id);
    const { data: rows } = await query.limit(50);
    if (!rows?.length) throw new BadRequestException('Nothing available to withdraw yet.');

    const results: Array<{ payment_id: string; ok: boolean; tx?: string; error?: string }> = [];
    // One at a time: each is its own on-chain sweep from its own burner.
    for (const row of rows) {
      try {
        const { sweepTxHash } = await this.claims.claimAsPartnerRecipient(row.id, recipientId, dto.destination_address);
        results.push({ payment_id: row.id, ok: true, tx: sweepTxHash });
      } catch (err) {
        results.push({ payment_id: row.id, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }
}

// Mirrors ClaimsService.PENDING_PARTNER_PREFIX without importing the whole static into a query helper.
const ClaimsServicePendingPartner = 'PENDING_PARTNER:';
