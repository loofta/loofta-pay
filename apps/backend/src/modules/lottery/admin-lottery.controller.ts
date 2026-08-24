import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { LotteryService } from './lottery.service';
import { MegapotService, MEGAPOT_JACKPOT } from './megapot.service';
import { PackService, PackTierConfig } from './pack.service';
import { MegapotSubscriptionService } from './megapot-subscription.service';
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

class RecordReferralFeeClaimDto {
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, { message: 'txHash must be a 32-byte 0x-prefixed transaction hash' })
  txHash: string;
}

class GrantFreeSpinDto {
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
    private readonly packs: PackService,
    private readonly subscriptions: MegapotSubscriptionService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('referral-fees')
  @ApiOperation({ summary: 'Read the live unclaimed Megapot referral fee balance plus the recorded claim history/total (claiming itself happens client-side from the admin\'s own connected wallet, see POST referral-fees/claim)' })
  async referralFees(): Promise<{
    balanceUsdc: number;
    claimedTotalUsdc: number;
    claims: any[];
    referrerWallet: string | null;
    jackpotContract: string;
    basescanWriteUrl: string | null;
  }> {
    const referrerWallet = this.megapot.getReferrers()[0] ?? null;
    const balanceUsdc = referrerWallet ? await this.megapot.getReferralFeesBalanceUsdc(referrerWallet) : 0;

    const db = this.supabase.getClient();
    // Sum across every recorded claim, not just the page below — same "don't undercount" fix as
    // the lottery ticket totals.
    const { data: allClaims } = await db.from('megapot_referral_fee_claims').select('amount_usdc');
    const claimedTotalUsdc = (allClaims ?? []).reduce((sum: number, c: any) => sum + Number(c.amount_usdc), 0);
    const { data: claims } = await db
      .from('megapot_referral_fee_claims')
      .select('id, tx_hash, claimer_address, amount_usdc, claimed_at')
      .order('claimed_at', { ascending: false })
      .limit(50);

    return {
      balanceUsdc,
      claimedTotalUsdc,
      claims: claims ?? [],
      referrerWallet,
      jackpotContract: MEGAPOT_JACKPOT,
      // Deep-links straight to the claimReferralFees write method on Basescan's contract UI —
      // still requires connecting the wallet that actually controls referrerWallet to sign it.
      basescanWriteUrl: referrerWallet ? `https://basescan.org/address/${MEGAPOT_JACKPOT}#writeContract` : null,
    };
  }

  @Post('referral-fees/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a Megapot referral-fee claim after the admin submits claimReferralFees() themselves from their own connected EVM wallet — verifies the tx on-chain (ReferralFeesClaimed event) before trusting the amount, so the claimed total can never be spoofed by client input' })
  async recordReferralFeeClaim(@Body() dto: RecordReferralFeeClaimDto) {
    let verified;
    try {
      verified = await this.megapot.verifyReferralFeeClaim(dto.txHash as `0x${string}`);
    } catch (e: any) {
      throw new BadRequestException(e.message ?? 'Could not verify this transaction on-chain');
    }
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('megapot_referral_fee_claims')
      .insert({
        tx_hash: dto.txHash.toLowerCase(),
        claimer_address: verified.claimerAddress,
        amount_usdc: verified.amountUsdc,
        block_number: Number(verified.blockNumber),
        claimed_at: verified.claimedAt.toISOString(),
      })
      .select('id, tx_hash, claimer_address, amount_usdc, claimed_at')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('This claim transaction was already recorded');
      throw new BadRequestException(error.message);
    }
    return data;
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
      .select('id, created_at, created_by_user_id, funding_mode, num_tickets, note, recipient_type, recipient_identifier, status, claimed_at, claimed_by_user_id, resulting_ticket_id, failure_reason, short_id, claim_token', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new BadRequestException(error.message);
    const data2 = (data ?? []).map((g: any) => ({
      ...g,
      claimUrl: `https://pay.loofta.xyz/gift/${g.short_id || g.claim_token}`,
    }));
    return { data: data2, total: count ?? 0, page, limit: pageSize };
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

  @Post('packs/grant-free-spin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant a free Mystery Pack spin to a registered recipient by email or X handle — no payment required, still a real tier roll and real ticket purchase' })
  async grantFreeSpin(@Body() dto: GrantFreeSpinDto, @Request() req: any) {
    return this.packs.grantFreeSpin({
      adminUserId: req.user.id,
      recipientType: dto.recipientType,
      recipientIdentifier: dto.recipientIdentifier,
      note: dto.note,
    });
  }

  @Get('packs/free-spins')
  @ApiOperation({ summary: 'List granted Mystery Pack free spins (paginated, newest first)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  async listFreeSpins(@Query('page') pageRaw?: string) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    return this.packs.getAdminFreeSpins(page, 50);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List Megapot ticket subscriptions (paginated, newest first)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  async listSubscriptions(@Query('page') pageRaw?: string) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    return this.subscriptions.getAdminSubscriptions(page, 50);
  }

  @Get('subscriptions/revenue')
  @ApiOperation({ summary: 'Megapot ticket subscription net revenue — gross collected minus refunds minus what delivered tickets cost' })
  async subscriptionsRevenue() {
    return this.subscriptions.getRevenue();
  }

  @Post('subscriptions/batches/:batchId/refund')
  @ApiOperation({ summary: "Refund a subscription batch whose treasury-funded purchase permanently failed (only when it never delivered a ticket)" })
  async refundSubscriptionBatch(@Param('batchId') batchId: string) {
    return this.subscriptions.refundFailedBatch(batchId);
  }
}
