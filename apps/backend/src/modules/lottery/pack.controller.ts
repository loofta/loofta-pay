import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { AuthGuard, Public } from '@/common/guards';
import { PackService, PackOpenResult, PackTierPublic } from './pack.service';

class OpenPackDto {
  /** Signature of the confirmed on-chain USDC transfer to the treasury address returned by
   *  GET config — verified server-side before any roll happens; never trusted at face value. */
  @IsString()
  paymentTxHash: string;
}

class BuildPaymentTxDto {
  @IsString()
  userSolanaAddress: string;
}

@ApiTags('lottery/packs')
@Controller('lottery/packs')
@UseGuards(AuthGuard)
export class PackController {
  constructor(private readonly packs: PackService) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Public pack tier ladder + treasury payment address (tickets/rarity only — odds are never exposed to the client)' })
  async config(): Promise<{ priceUsdc: number; treasuryAddress: string; usdcMint: string; tiers: PackTierPublic[] }> {
    return this.packs.getPublicConfig();
  }

  @Post('pay-tx')
  @ApiOperation({ summary: 'Build the $2 USDC payment transfer for the caller to sign client-side (gas + destination ATA sponsored by the treasury wallet)' })
  async payTx(@Body() dto: BuildPaymentTxDto, @Request() req: any): Promise<{ txBase64: string }> {
    const txBase64 = await this.packs.buildPaymentTx(dto.userSolanaAddress, req.user.id);
    return { txBase64 };
  }

  @Post('open')
  @ApiOperation({ summary: 'Open a Mystery Pack — requires a confirmed on-chain USDC payment tx hash, verified server-side' })
  async open(@Body() dto: OpenPackDto, @Request() req: any): Promise<PackOpenResult> {
    return this.packs.openPack(req.user.id, dto.paymentTxHash);
  }

  @Post('demo-open')
  @ApiOperation({ summary: 'Dev-only: same real tier roll as /open, but no payment required and no real ticket purchased — hard-blocked in production' })
  async demoOpen(@Request() req: any): Promise<PackOpenResult> {
    return this.packs.openPackDemo(req.user.id);
  }

  @Get('pending-payment')
  @ApiOperation({ summary: 'Look for a real, confirmed pack payment the caller already sent but never got to redeem (e.g. the client dropped the request after a successful on-chain send) — lets the frontend recover it instead of charging a second time' })
  async pendingPayment(@Request() req: any): Promise<{ paymentTxHash: string | null }> {
    const found = await this.packs.findRecoverablePayment(req.user.id);
    return { paymentTxHash: found?.paymentTxHash ?? null };
  }

  @Get('my-status')
  @ApiOperation({ summary: "Caller's own daily pack-open usage — lets the frontend show a 'you've hit today's limit' message before ever offering payment" })
  async myStatus(@Request() req: any): Promise<{ opensToday: number; dailyLimit: number | null; limitReached: boolean }> {
    return this.packs.getMyPackStatus(req.user.id);
  }
}
