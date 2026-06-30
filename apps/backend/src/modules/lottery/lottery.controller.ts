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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber, IsString, IsIn, IsArray, Min } from 'class-validator';
import { AuthGuard } from '@/common/guards';
import { LotteryService, InitiatePurchaseResult, InitiatePublicPurchaseResult, LotteryDashboard, LotteryTicketSummary } from './lottery.service';
import { LifiService } from './lifi.service';

class BuyTicketsDto {
  @IsNumber()
  @Min(1)
  numTickets: number;

  @IsString()
  userSolanaAddress: string;
}

class ConfirmSendDto {
  @IsString()
  ticketId: string;

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
  @ApiOperation({ summary: 'Get actual Li.Fi bridge fee for withdrawal amount (Base→Solana)' })
  async bridgeFee(@Query('amountUsdc') amountUsdc: string): Promise<{ feeUsd: number; receiveUsdc: number }> {
    const amount = parseFloat(amountUsdc);
    if (!amount || amount <= 0) throw new BadRequestException('amountUsdc required');
    return this.lifi.getWithdrawalFeeEstimate(amount);
  }

  @Post('buy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate ticket purchase — returns MagicBlock tx for user to sign' })
  async buy(@Body() dto: BuyTicketsDto, @Request() req: any): Promise<InitiatePurchaseResult> {
    if (!dto.numTickets || dto.numTickets < 1) throw new BadRequestException('numTickets required');
    if (!dto.userSolanaAddress) throw new BadRequestException('userSolanaAddress required');
    return this.lottery.initiatePurchase({
      userId: req.user.id,
      numTickets: dto.numTickets,
      userSolanaAddress: dto.userSolanaAddress,
    });
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
  async rescue(@Param('ticketId') ticketId: string, @Request() req: any): Promise<{ ok: boolean }> {
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
