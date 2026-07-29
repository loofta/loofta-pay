import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { LotteryService } from './lottery.service';
import { MegapotService, MEGAPOT_JACKPOT } from './megapot.service';
import { PackService, PackTierConfig } from './pack.service';
import { SupabaseService } from '@/database/supabase.service';

class CreateGiftDto {
  @IsInt()
  @Min(1)
  @Max(100)
  numTickets: number;

  @IsIn(['email', 'handle'])
  recipientType: 'email' | 'handle';

  @IsString()
  recipientIdentifier: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class SetPackTierEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

class SetPackDailyLimitDto {
  // Null clears the limit (unlimited); when set, PackService.setDailyOpenLimit itself enforces
  // "positive integer" — kept optional/loose here so null round-trips through validation.
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyOpenLimit: number | null;
}

@ApiTags('admin/lottery')
@Controller('admin/lottery')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AdminLotteryController {
  constructor(
    private readonly lottery: LotteryService,
    private readonly megapot: MegapotService,
    private readonly packs: PackService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('referral-fees')
  @ApiOperation({ summary: 'Read the live, unclaimed Megapot referral fee balance (view-only — claiming is manual, see response)' })
  async referralFees(): Promise<{ balanceUsdc: number; referrerWallet: string | null; jackpotContract: string; basescanWriteUrl: string | null }> {
    const referrerWallet = this.megapot.getReferrers()[0] ?? null;
    const balanceUsdc = referrerWallet ? await this.megapot.getReferralFeesBalanceUsdc(referrerWallet) : 0;
    return {
      balanceUsdc,
      referrerWallet,
      jackpotContract: MEGAPOT_JACKPOT,
      // Deep-links straight to the claimReferralFees write method on Basescan's contract UI —
      // still requires connecting the wallet that actually controls referrerWallet to sign it.
      basescanWriteUrl: referrerWallet ? `https://basescan.org/address/${MEGAPOT_JACKPOT}#writeContract` : null,
    };
  }

  @Post('gift')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gift N Megapot tickets to a recipient by email or X handle' })
  async gift(@Body() dto: CreateGiftDto, @Request() req: any) {
    return this.lottery.createGift({
      adminUserId: req.user.id,
      numTickets: dto.numTickets,
      recipientType: dto.recipientType,
      recipientIdentifier: dto.recipientIdentifier,
      note: dto.note,
    });
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-check every stale ticket across ALL users right now (same work the 15-minute cron does) — triggered by admin panel loads so an admin visiting the Lottery tab doesn\'t have to wait for the next tick' })
  async reconcile(): Promise<{ ok: boolean }> {
    await this.lottery.checkDailyResults();
    return { ok: true };
  }

  @Get('gifts')
  @ApiOperation({ summary: 'List gifted tickets (paginated, newest first)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  async listGifts(@Query('page') pageRaw?: string) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = 50;
    const db = this.supabase.getClient();
    const { data, count, error } = await db
      .from('lottery_gifts')
      .select('id, created_at, created_by_user_id, funding_mode, num_tickets, note, recipient_type, recipient_identifier, status, claimed_at, claimed_by_user_id, resulting_ticket_id, failure_reason', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], total: count ?? 0, page, limit: pageSize };
  }

  @Get('packs/tiers')
  @ApiOperation({ summary: 'Full Mystery Pack tier config including odds + enabled flags (never exposed to the public config endpoint)' })
  async packTiers(): Promise<PackTierConfig[]> {
    return this.packs.getAdminTiers();
  }

  @Patch('packs/tiers/:tierKey')
  @ApiOperation({ summary: 'Enable/disable a Mystery Pack tier. Weights are untouched — a disabled tier just falls back to the next-lower enabled one at roll time, so this is a silent, instant, single-field toggle with no other math or frontend change required.' })
  async setPackTierEnabled(@Param('tierKey') tierKey: string, @Body() dto: SetPackTierEnabledDto): Promise<PackTierConfig> {
    return this.packs.setTierEnabled(tierKey, dto.enabled);
  }

  @Get('packs/treasury')
  @ApiOperation({ summary: "Mystery Pack treasury balance + funding threshold — the public config endpoint only exposes a boolean, this is the actual number + address for admin visibility ('add funds' if below threshold)." })
  async packTreasury() {
    return this.packs.getTreasuryStatus();
  }

  @Get('packs/revenue')
  @ApiOperation({ summary: 'Mystery Pack net revenue — real (non-demo) pack payments collected minus what the tickets awarded actually cost' })
  async packRevenue() {
    return this.packs.getRevenue();
  }

  @Get('packs/settings')
  @ApiOperation({ summary: 'Mystery Pack global settings (currently: daily open limit per user, null = unlimited)' })
  async packSettings(): Promise<{ dailyOpenLimit: number | null }> {
    return { dailyOpenLimit: await this.packs.getDailyOpenLimit() };
  }

  @Patch('packs/settings')
  @ApiOperation({ summary: 'Set (or clear, with null) the daily open limit per user' })
  async setPackSettings(@Body() dto: SetPackDailyLimitDto): Promise<{ dailyOpenLimit: number | null }> {
    return this.packs.setDailyOpenLimit(dto.dailyOpenLimit ?? null);
  }

  @Get('packs/openings')
  @ApiOperation({ summary: 'Recent Mystery Pack openings (real + demo), paginated, newest first' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  async packOpenings(@Query('page') pageRaw?: string) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    return this.packs.getAdminOpenings(page, 50);
  }

  @Post('packs/openings/:id/refund')
  @ApiOperation({ summary: "Refund a 'failed' pack opening's cost to the user's wallet and email them (only when its treasury ticket purchase never landed)" })
  async refundPackOpening(@Param('id') id: string) {
    return this.packs.refundFailedPackOpening(id);
  }
}
