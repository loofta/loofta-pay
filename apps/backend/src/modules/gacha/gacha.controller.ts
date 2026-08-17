import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AuthGuard, Public } from '@/common/guards';
import { GachaService } from './gacha.service';

class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  configKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  name?: string;

  @IsBoolean()
  isPrivate: boolean;
}

class ConfirmJoinDto {
  @IsString()
  paymentTxHash: string;

  @IsString()
  mascotKey: string;
}

class PlaceBidDto {
  @IsNumber()
  @Min(0.01)
  amountUsdc: number;
}

class PayBidDto {
  @IsString()
  paymentTxHash: string;
}

class ClaimPayoutDto {
  @IsBoolean()
  isPrivate: boolean;
}

@ApiTags('gacha')
@Controller('gacha')
@UseGuards(AuthGuard)
export class GachaController {
  constructor(private readonly gacha: GachaService) {}

  @Get('configs')
  @Public()
  @ApiOperation({ summary: 'Public room presets (seats/entry price/pack type)' })
  async configs() {
    return this.gacha.getPublicConfigs();
  }

  @Get('rooms')
  @Public()
  @ApiOperation({ summary: 'Open rooms (waiting through settling) with live seat counts' })
  async rooms() {
    return this.gacha.listOpenRooms();
  }

  @Get('rooms/waiting')
  @Public()
  @ApiOperation({ summary: 'Public waiting rooms for one config, fullest first, with seated mascot previews' })
  async waitingRooms(@Query('configKey') configKey: string) {
    return this.gacha.listPublicWaitingRooms(configKey);
  }

  @Get('rooms/next-number')
  @Public()
  @ApiOperation({ summary: 'Display hint for the next room number in one config' })
  async nextRoomNumber(@Query('configKey') configKey: string) {
    return this.gacha.getNextRoomNumber(configKey);
  }

  @Get('rooms/invite/:inviteCode')
  @Public()
  @ApiOperation({ summary: 'Safe preview for a private waiting room addressed by its bearer invite code' })
  async inviteRoom(@Param('inviteCode') inviteCode: string) {
    return this.gacha.getWaitingRoomByInviteCode(inviteCode);
  }

  @Get('rooms/current')
  @ApiOperation({ summary: 'Recover the caller\'s current waiting room for one config, including unseated creator-owned rooms' })
  async currentWaitingRoom(@Query('configKey') configKey: string, @Request() req: any) {
    return this.gacha.getCurrentWaitingRoom(configKey, req.user.id);
  }

  @Post('rooms')
  @ApiOperation({ summary: 'Create a distinct public or private waiting room' })
  async createRoom(@Body() dto: CreateRoomDto, @Request() req: any) {
    return this.gacha.createWaitingRoom(dto.configKey, req.user.id, dto.name, dto.isPrivate);
  }

  @Get('my-devnet-balance')
  @ApiOperation({ summary: "Caller's own devnet USDC-Dev balance at the mint Gacha actually uses (separate from the app's general devnet toggle, which points at a different mint)" })
  async myDevnetBalance(@Request() req: any) {
    return this.gacha.getMyDevnetUsdcBalance(req.user.id);
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: "Full room detail plus the caller's own participation/payout/bid state" })
  async room(@Param('id') id: string, @Query('inviteCode') inviteCode: string | undefined, @Request() req: any) {
    return this.gacha.getRoomDetail(id, req.user.id, inviteCode);
  }

  @Post('rooms/:id/run-it-back')
  @ApiOperation({ summary: 'Create or recover the shared next waiting room for a settled room' })
  async runItBack(@Param('id') id: string, @Request() req: any) {
    return this.gacha.runItBack(id, req.user.id);
  }

  @Post('rooms/:id/fill-with-bots')
  @ApiOperation({ summary: 'Devnet testing only — fills every open seat with fake, treasury-funded participants. Blocked in production.' })
  async fillWithBots(@Param('id') id: string) {
    return this.gacha.fillRemainingSeatsWithBots(id);
  }

  @Post('rooms/:id/force-settle')
  @ApiOperation({ summary: 'Devnet testing only — settles a bidding/settling room immediately instead of waiting for the (production-only) cron sweep. Blocked in production.' })
  async forceSettle(@Param('id') id: string) {
    return this.gacha.devForceSettleRoom(id);
  }

  @Post('rooms/:id/force-exclude')
  @ApiOperation({ summary: 'Devnet testing only — runs a room stuck mid-exclusion-draw to completion immediately instead of waiting for the (production-only) cron sweep. Blocked in production.' })
  async forceExclude(@Param('id') id: string) {
    return this.gacha.devForceAdvanceExcluding(id);
  }

  @Post('rooms/:id/force-vote')
  @ApiOperation({ summary: 'Devnet testing only — forces the current vote round closed (skipping the 30s timeout) and any resulting cut draw to completion. Blocked in production.' })
  async forceVote(@Param('id') id: string) {
    return this.gacha.devForceAdvanceVoting(id);
  }

  @Post('rooms/:id/join-tx')
  @ApiOperation({ summary: 'Build the entry payment transaction for this exact waiting room' })
  async roomJoinTx(@Param('id') id: string, @Query('inviteCode') inviteCode: string | undefined, @Request() req: any) {
    return this.gacha.buildJoinTxForRoom(id, req.user.id, inviteCode);
  }

  @Post('rooms/:id/join')
  @ApiOperation({ summary: 'Confirm entry payment and take a seat — requires a confirmed on-chain payment tx hash' })
  async join(@Param('id') id: string, @Query('inviteCode') inviteCode: string | undefined, @Body() dto: ConfirmJoinDto, @Request() req: any) {
    return this.gacha.confirmJoin(id, req.user.id, dto.paymentTxHash, dto.mascotKey, inviteCode);
  }

  @Delete('rooms/:id/leave')
  @ApiOperation({ summary: 'Release a waiting seat, or cancel the caller-owned room while it is still empty' })
  async leaveRoom(@Param('id') id: string, @Request() req: any) {
    return this.gacha.leaveWaitingRoom(id, req.user.id);
  }

  @Post('rooms/:id/bid')
  @ApiOperation({ summary: 'Place a bid on the revealed card — room participants only' })
  async bid(@Param('id') id: string, @Body() dto: PlaceBidDto, @Request() req: any) {
    return this.gacha.placeBid(id, req.user.id, dto.amountUsdc);
  }

  @Post('rooms/:id/pay-bid-tx')
  @ApiOperation({ summary: 'Build the winning-bid payment tx — only for the caller currently holding the pending bid' })
  async payBidTx(@Param('id') id: string, @Request() req: any) {
    return this.gacha.buildBidPaymentTx(id, req.user.id);
  }

  @Post('rooms/:id/pay-bid')
  @ApiOperation({ summary: 'Confirm the winning bid payment — settles the room immediately' })
  async payBid(@Param('id') id: string, @Body() dto: PayBidDto, @Request() req: any) {
    await this.gacha.confirmBidPayment(id, req.user.id, dto.paymentTxHash);
    return { ok: true };
  }

  @Post('rooms/:id/claim')
  @ApiOperation({ summary: "Claim this caller's settled payout, publicly or privately" })
  async claim(@Param('id') id: string, @Body() dto: ClaimPayoutDto, @Request() req: any) {
    return this.gacha.claimPayout(id, req.user.id, dto.isPrivate);
  }
}
