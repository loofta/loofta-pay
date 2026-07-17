import { Controller, Get, Post, Body, Query, Request, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { LotteryService } from './lottery.service';
import { MegapotService, MEGAPOT_JACKPOT } from './megapot.service';
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

@ApiTags('admin/lottery')
@Controller('admin/lottery')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AdminLotteryController {
  constructor(
    private readonly lottery: LotteryService,
    private readonly megapot: MegapotService,
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
}
