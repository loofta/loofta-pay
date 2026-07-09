import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber, IsString, IsIn, IsArray, IsOptional, Min, Max } from 'class-validator';
import { AuthGuard, Public, OptionalAuthGuard } from '@/common/guards';
import { LotteryService, InitiatePurchaseResult, InitiatePublicPurchaseResult, LotteryDashboard, LotteryTicketSummary } from './lottery.service';
import { LifiService } from './lifi.service';

class BuyTicketsDto {
  @IsNumber()
  @Min(1)
  @Max(100)
  numTickets: number;

  @IsString()
  userSolanaAddress: string;
}

class BuyGiftDto {
  @IsNumber()
  @Min(1)
  @Max(100)
  numTickets: number;

  @IsString()
  userSolanaAddress: string;

  @IsIn(['email', 'handle'])
  recipientType: 'email' | 'handle';

  @IsString()
  recipientIdentifier: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class ConfirmSendDto {
  @IsString()
  ticketId: string;

  @IsString()
  senderTxHash: string;
}

class ConfirmFeeDto {
  @IsString()
  ticketId: string;

  @IsString()
  feeTxHash: string;
}

class ConfirmGiftFeeDto {
  @IsString()
  giftId: string;

  @IsString()
  feeTxHash: string;
}

class ConfirmGiftSendDto {
  @IsString()
  giftId: string;

  @IsString()
  senderTxHash: string;
}

class WithdrawDto {
  @IsString()
  ticketId: string;

  @IsIn(['base', 'solana_private'])
  route: 'base' | 'solana_private';

  @IsString()
  destinationAddress: string;
}

class RescueBurnerDto {
  @IsString()
  destinationSolAddress: string;
}

class WithdrawBatchDto {
  @IsArray()
  @IsString({ each: true })
  ticketIds: string[];

  @IsString()
  destinationAddress: string;
}

@ApiTags('lottery')
@Controller('lottery')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class LotteryController {
  constructor(
    private readonly lottery: LotteryService,
    private readonly lifi: LifiService,
  ) {}

  @Get('bridge-fee')
  @Public()
  @ApiOperation({ summary: 'Estimate net a private withdrawal delivers (Li.Fi bridge + MagicBlock fees, Base→Solana)' })
  async bridgeFee(@Query('amountUsdc') amountUsdc: string): Promise<{ feeUsd: number; receiveUsdc: number }> {
    const amount = parseFloat(amountUsdc);
    if (!amount || amount <= 0 || amount > 1_000_000) throw new BadRequestException('amountUsdc must be between 0 and 1,000,000');
    try {
      return await this.lottery.estimatePrivateWithdrawalNet(amount);
    } catch (e: any) {
      // No fabricated fallback — a fee estimate that doesn't match the real bridge is worse than
      // none. 503 tells the frontend to show "unavailable, try again", not a guessed number.
      throw new ServiceUnavailableException(`Could not get a real fee quote right now: ${e.message}`);
    }
  }

  @Post('buy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate ticket purchase — returns fee tx + MagicBlock tx for user to sign, in that order' })
  async buy(@Body() dto: BuyTicketsDto, @Request() req: any): Promise<InitiatePurchaseResult> {
    if (!dto.numTickets || dto.numTickets < 1) throw new BadRequestException('numTickets required');
    if (!dto.userSolanaAddress) throw new BadRequestException('userSolanaAddress required');
    return this.lottery.initiatePurchase({
      userId: req.user.id,
      numTickets: dto.numTickets,
      userSolanaAddress: dto.userSolanaAddress,
    });
  }

  @Post('buy-fee-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the upfront fee tx signed — must be called before buy-confirm' })
  async confirmFee(@Body() dto: ConfirmFeeDto, @Request() req: any): Promise<{ ok: boolean }> {
    if (!dto.ticketId || !dto.feeTxHash) throw new BadRequestException('ticketId and feeTxHash required');
    await this.lottery.confirmFeeCollection({ ticketId: dto.ticketId, userId: req.user.id, feeTxHash: dto.feeTxHash });
    return { ok: true };
  }

  @Post('buy-public')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate public (non-private) ticket purchase — returns NEAR Intents deposit address' })
  async buyPublic(@Body() body: any, @Request() req: any): Promise<InitiatePublicPurchaseResult> {
    const numTickets = Number(body?.numTickets);
    if (!numTickets || numTickets < 1) throw new BadRequestException('numTickets required');
    return this.lottery.initiatePublicPurchase({
      userId: req.user.id,
      numTickets,
    });
  }

  @Post('buy-gift')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pay for a gift (N tickets for someone else) — returns fee tx + MagicBlock tx to sign, in that order. The Megapot purchase itself only happens when the recipient claims (see gift/:token/claim).' })
  async buyGift(@Body() dto: BuyGiftDto, @Request() req: any): Promise<{ giftId: string; feeTxBase64: string; feeWalletAddress: string; txBase64: string; requiredSigners: string[] }> {
    if (!dto.numTickets || dto.numTickets < 1) throw new BadRequestException('numTickets required');
    if (!dto.userSolanaAddress) throw new BadRequestException('userSolanaAddress required');
    if (!dto.recipientIdentifier) throw new BadRequestException('recipientIdentifier required');
    return this.lottery.initiateGiftedPurchase({
      userId: req.user.id,
      userSolanaAddress: dto.userSolanaAddress,
      numTickets: dto.numTickets,
      recipientType: dto.recipientType,
      recipientIdentifier: dto.recipientIdentifier,
      note: dto.note,
    });
  }

  @Post('buy-gift-fee-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the gift upfront fee tx signed — must be called before buy-gift-confirm' })
  async confirmGiftFee(@Body() dto: ConfirmGiftFeeDto, @Request() req: any): Promise<{ ok: boolean }> {
    if (!dto.giftId || !dto.feeTxHash) throw new BadRequestException('giftId and feeTxHash required');
    await this.lottery.confirmGiftFee({ giftId: dto.giftId, userId: req.user.id, feeTxHash: dto.feeTxHash });
    return { ok: true };
  }

  @Post('buy-gift-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the gift MagicBlock tx signed — this is what makes the gift real and notifies the recipient' })
  async confirmGiftSend(@Body() dto: ConfirmGiftSendDto, @Request() req: any): Promise<{ claimUrl: string }> {
    if (!dto.giftId || !dto.senderTxHash) throw new BadRequestException('giftId and senderTxHash required');
    return this.lottery.confirmGiftSend({ giftId: dto.giftId, userId: req.user.id, senderTxHash: dto.senderTxHash });
  }

  @Post('buy-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm MagicBlock tx signed — start bridge monitoring' })
  async confirmBuy(@Body() dto: ConfirmSendDto, @Request() req: any): Promise<{ ok: boolean }> {
    if (!dto.ticketId || !dto.senderTxHash) throw new BadRequestException('ticketId and senderTxHash required');
    await this.lottery.confirmSend({ ticketId: dto.ticketId, userId: req.user.id, senderTxHash: dto.senderTxHash });
    return { ok: true };
  }

  @Get('status/:ticketId')
  @ApiOperation({ summary: 'Get ticket status (poll during purchase flow)' })
  async status(@Param('ticketId') ticketId: string, @Request() req: any): Promise<LotteryTicketSummary | null> {
    return this.lottery.getTicketStatus(ticketId, req.user.id);
  }

  @Post('tickets/:ticketId/sync-numbers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch NFT ball numbers for a ticket from Megapot and store them' })
  async syncNumbers(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ ok: boolean; count: number }> {
    return this.lottery.syncTicketNumbers(ticketId, req.user.id);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get full lottery dashboard for current user' })
  async dashboard(@Request() req: any): Promise<LotteryDashboard> {
    return this.lottery.getDashboard(req.user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Paginated ticket history for current user (finished tickets, newest first)' })
  async history(
    @Query('offset') offsetRaw: string,
    @Query('limit') limitRaw: string,
    @Request() req: any,
  ): Promise<{ tickets: LotteryTicketSummary[]; total: number }> {
    const offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw, 10) || 20));
    return this.lottery.getTicketHistory(req.user.id, offset, limit);
  }

  @Delete('tickets/:ticketId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending_send ticket (no funds sent yet)' })
  async cancel(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ ok: boolean }> {
    await this.lottery.cancelTicket(ticketId, req.user.id);
    return { ok: true };
  }

  @Post('tickets/:ticketId/rescue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rescue stuck USDC from companion wallet back to safe address via Rhinestone' })
  async rescue(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ ok: boolean; rescued: boolean; amountUsdc: number; message: string }> {
    return this.lottery.rescueCompanionFunds(ticketId, req.user.id);
  }

  @Post('tickets/:ticketId/rescue-burner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rescue stuck USDC from Solana burner wallet back to user Solana address' })
  async rescueBurner(
    @Param('ticketId') ticketId: string,
    @Body() dto: RescueBurnerDto,
    @Request() req: any,
  ): Promise<{ ok: boolean; message: string }> {
    return this.lottery.rescueBurnerFunds(ticketId, req.user.id, dto.destinationSolAddress);
  }

  @Post('tickets/:ticketId/check-results')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually check win/loss result after draw — updates ticket status immediately' })
  async checkResults(
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ): Promise<{ status: string; winAmountUsdc: number | null; winTier: number | null }> {
    return this.lottery.checkTicketResult(ticketId, req.user.id);
  }

  @Post('tickets/:ticketId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed ticket purchase — requeues for the next cron run' })
  async retry(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ ok: boolean }> {
    return this.lottery.retryTicket(ticketId, req.user.id);
  }

  @Get('tickets/:ticketId/check-deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fast Solana RPC check for USDC deposit — triggers immediate bridging if found' })
  async checkDeposit(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ status: string }> {
    return this.lottery.checkDepositFast(ticketId, req.user.id);
  }

  @Post('tickets/:ticketId/play-again')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim winnings and reinvest into new Megapot tickets — no bridge, no fees' })
  async playAgain(
    @Param('ticketId') ticketId: string,
    @Request() req: any,
  ): Promise<{ newTicketId: string; numTickets: number; roundId: string | null }> {
    return this.lottery.playAgain({ ticketId, userId: req.user.id });
  }

  @Post('withdraw-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch private withdrawal — all companion wallets converge to one shared burner → single MagicBlock transfer' })
  async withdrawBatch(@Body() dto: WithdrawBatchDto, @Request() req: any): Promise<{ withdrawalIds: string[]; batchId: string }> {
    if (!dto.ticketIds?.length) throw new BadRequestException('ticketIds required');
    if (!dto.destinationAddress) throw new BadRequestException('destinationAddress required');
    return this.lottery.initiateWithdrawalBatch({
      ticketIds: dto.ticketIds,
      userId: req.user.id,
      destinationAddress: dto.destinationAddress,
    });
  }

  @Get('gift/:token')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get public gift details for the claim page — auth optional, used to tell sender/claimant/stranger apart' })
  async getGift(@Param('token') token: string, @Request() req: any): Promise<{
    numTickets: number; note: string | null; status: string; recipientType: 'email' | 'handle';
    isSender: boolean; isClaimant: boolean;
  }> {
    return this.lottery.getGiftPublic(token, req.user?.id);
  }

  @Get('my-gifts')
  @ApiOperation({ summary: 'Paginated self-service gifts the current user has sent (sender_paid), with status + claim link' })
  async myGifts(
    @Query('offset') offsetRaw: string,
    @Query('limit') limitRaw: string,
    @Request() req: any,
  ) {
    const offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw, 10) || 20));
    return this.lottery.getMyGifts(req.user.id, offset, limit);
  }

  @Post('gift/:token/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim a gifted ticket — verifies identity, then buys the ticket(s) now' })
  async claimGift(@Param('token') token: string, @Request() req: any): Promise<{ ticketId: string; numTickets: number }> {
    return this.lottery.claimGift(token, req.user.id);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate withdrawal — Base (free) or private Solana' })
  async withdraw(@Body() dto: WithdrawDto, @Request() req: any): Promise<{ withdrawalId: string }> {
    if (!dto.ticketId || !dto.route || !dto.destinationAddress) {
      throw new BadRequestException('ticketId, route, and destinationAddress required');
    }
    if (!['base', 'solana_private'].includes(dto.route)) {
      throw new BadRequestException('route must be "base" or "solana_private"');
    }
    return this.lottery.initiateWithdrawal({
      ticketId: dto.ticketId,
      userId: req.user.id,
      route: dto.route,
      destinationAddress: dto.destinationAddress,
    });
  }
}
