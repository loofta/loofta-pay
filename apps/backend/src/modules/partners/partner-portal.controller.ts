import {
  BadRequestException,
  CanActivate,
  Body,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupabaseService } from '@/database/supabase.service';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import { assertSafePublicUrl } from '@/common/assert-safe-public-url';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { PortalSession, PortalTokenService } from './portal-token.service';

const PLATFORMS = ['twitter', 'discord', 'github', 'telegram'] as const;

export class PortalTokenRequestDto {
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(PLATFORMS as unknown as string[]) platform?: (typeof PLATFORMS)[number];
  @IsOptional() @IsString() @MaxLength(100) handle?: string;
  /** Your own id for the user, if you imported them with one. */
  @IsOptional() @IsString() @MaxLength(200) external_user_id?: string;
  @IsOptional() @IsString() @MaxLength(500) return_url?: string;
}

/**
 * Called by the partner's SERVER with its API key. It asserts which of its users is looking at the
 * widget and gets back a 15 minute token for the browser. The key never reaches the browser.
 */
@ApiTags('partner-portal')
@Controller('partner-portal')
export class PartnerPortalTokenController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly tokens: PortalTokenService,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('portal:token')
  @RateLimit(300, 60, 'partner-portal:token', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Mint a 15 minute widget token for one of your users (by email, handle or your own user id)' })
  async token(@Body() dto: PortalTokenRequestDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const { data: partner } = await this.supabase.partners.select('id, status').eq('integrator_id', req.integrator.id).maybeSingle();
    if (!partner) throw new ForbiddenException('This API key is not linked to a partner account.');
    if (partner.status !== 'active') throw new ForbiddenException('This partner account is suspended.');

    let identity: { email?: string; platform?: string; handle?: string } | null = null;
    if (dto.external_user_id) {
      const { data: r } = await this.supabase.partnerRecipients
        .select('email, handle_platform, handle')
        .eq('partner_id', partner.id)
        .eq('external_user_id', dto.external_user_id)
        .maybeSingle();
      if (!r) throw new NotFoundException('Unknown external_user_id. Import this user first, or pass an email or handle.');
      identity = r.email ? { email: String(r.email).toLowerCase() } : r.handle_platform && r.handle ? { platform: r.handle_platform as string, handle: String(r.handle).toLowerCase() } : null;
    } else if (dto.email) {
      identity = { email: dto.email.trim().toLowerCase() };
    } else if (dto.platform && dto.handle) {
      identity = { platform: dto.platform, handle: dto.handle.replace(/^@/, '').replace(/#\d+$/, '').trim().toLowerCase() };
    }
    if (!identity) throw new BadRequestException('Pass an email, a platform and handle, or an external_user_id.');

    if (dto.return_url) assertSafePublicUrl(dto.return_url, 'return_url');
    return this.tokens.mint({ partnerId: partner.id, ...identity, ...(dto.return_url ? { returnUrl: dto.return_url } : {}) });
  }
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

const FUNDED = new Set(['PRIVATE_TRANSFER_PENDING', 'SUCCESS']);

/**
 * What the embedded widget reads. Scoped by the partner and identity inside the verified token,
 * never by anything in the request, so a user only ever sees payouts this partner made to them.
 */
@ApiTags('partner-portal')
@Controller('portal')
@UseGuards(PortalGuard, RateLimitGuard)
export class PortalController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  @RateLimit(120, 60, 'portal:me')
  @ApiOperation({ summary: 'Balance and payouts received from this partner, for the user in the widget token' })
  async me(@Req() req: { portal: PortalSession }) {
    const s = req.portal;
    const { data: partner } = await this.supabase.partners
      .select('org_id, name, logo_url, brand_color, description, withdraw_min_usd, fee_fixed_usd, fee_percent_bps, status')
      .eq('id', s.partnerId)
      .maybeSingle();
    if (!partner) throw new NotFoundException('Partner not found.');

    let q = this.supabase.payments
      .select('amount, status, description, created_at, paid_at, partner_withdrawn_at')
      .eq('partner_id', s.partnerId);
    q = s.email ? q.eq('recipient_email', s.email) : q.eq('recipient_address', `PENDING_SOCIAL:${s.platform}:${s.handle}`);
    const { data: rows } = await q.order('created_at', { ascending: false }).limit(200);

    // Only money that is actually in the burner is shown: drafts and unfunded rows are not payouts yet.
    const history = (rows ?? [])
      .filter((r) => r.partner_withdrawn_at || FUNDED.has(String(r.status).toUpperCase()))
      .map((r) => ({
        amount: Number(r.amount) || 0,
        message: (r.description as string | null) ?? null,
        received_at: (r.paid_at as string | null) ?? (r.created_at as string),
        state: r.partner_withdrawn_at ? ('withdrawn' as const) : ('available' as const),
      }));
    const sum = (state: 'available' | 'withdrawn') => Math.round(history.filter((h) => h.state === state).reduce((a, h) => a + h.amount, 0) * 100) / 100;

    const base = (this.config.get<string>('PAY_APP_URL') || 'https://pay.loofta.com').replace(/\/$/, '');
    return {
      partner: { name: partner.name, logo_url: partner.logo_url, brand_color: partner.brand_color, description: partner.description },
      identity: s.email ?? `${s.platform}:${s.handle}`,
      available_usd: sum('available'),
      withdrawn_usd: sum('withdrawn'),
      min_withdraw_usd: Number(partner.withdraw_min_usd) || 0,
      withdraw_url: `${base}/withdraw?orgId=${encodeURIComponent(partner.org_id)}`,
      return_url: s.returnUrl ?? null,
      history,
    };
  }
}
