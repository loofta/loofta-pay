import {
  Controller, Post, Get, Body, Param, Req,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { OfframpService } from './offramp.service';
import { CreateOfframpDto } from './dto/create-offramp.dto';

@ApiTags('offramp')
@Controller('offramp')
export class OfframpController {
  constructor(private readonly offramp: OfframpService) {}

  @Post('prepare')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Prepare a Peer offramp — quotes a Relay bridge of Solana USDC to the user Base wallet' })
  async prepare(@Req() req: any, @Body() dto: CreateOfframpDto) {
    if (!dto.platform || !dto.identifier || !dto.solanaAddress || !dto.baseWalletAddress || !(dto.amountUSDC > 0)) {
      throw new BadRequestException('platform, identifier, solanaAddress, baseWalletAddress, and amountUSDC are required');
    }
    return this.offramp.prepareOfframp(req.user.id, dto);
  }

  @Post(':id/relay-tx')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Build the unsigned Relay Solana deposit for this offramp' })
  async relayTx(@Req() req: any, @Param('id') id: string) {
    return this.offramp.buildRelayDepositTx(id, req.user.id);
  }

  @Post(':id/relay-broadcast')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Co-sign and broadcast the user-signed Relay deposit' })
  async relayBroadcast(@Req() req: any, @Param('id') id: string, @Body() body: { transaction?: string }) {
    if (!body?.transaction) throw new BadRequestException('transaction is required');
    return this.offramp.submitRelayDeposit(id, req.user.id, body.transaction);
  }

  @Get(':id/relay-status')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Poll the Relay bridge for this offramp' })
  async relayStatus(@Req() req: any, @Param('id') id: string) {
    return this.offramp.getRelayStatus(id, req.user.id);
  }

  @Post(':id/confirm-bridge')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark that the Solana→Base bridge tx has been sent' })
  async confirmBridge(@Req() req: any, @Param('id') id: string) {
    return this.offramp.confirmBridge(id, req.user.id);
  }

  @Post(':id/record-deposit')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record Peer deposit created by the user\'s Base wallet' })
  async recordDeposit(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { depositId?: string; txHash?: string; accessPolicyTxHash?: string; etaSeconds?: number; etaLabel?: string },
  ) {
    return this.offramp.recordDeposit(
      id, req.user.id,
      body.depositId ?? null, body.txHash ?? null,
      body.accessPolicyTxHash ?? null, body.etaSeconds ?? null, body.etaLabel ?? null,
    );
  }

  @Post(':id/bridge-back')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get Near Intents bridge address to send Base USDC back to user\'s Solana wallet' })
  async bridgeBack(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { baseWalletAddress: string; amountUsdc?: number },
  ) {
    if (!body.baseWalletAddress) throw new BadRequestException('baseWalletAddress is required');
    return this.offramp.getBridgeBackAddress(id, req.user.id, body.baseWalletAddress, body.amountUsdc);
  }

  @Get('pending')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get latest pending offramp for the current user (for session recovery)' })
  async getPending(@Req() req: any) {
    return this.offramp.getPendingForUser(req.user.id);
  }

  @Get('history')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get last 10 offramp requests for the current user' })
  async getHistory(@Req() req: any) {
    return this.offramp.getUserOfframps(req.user.id);
  }

  @Get('public/:shortId')
  @ApiOperation({ summary: 'Public pay-to-app share preview — no wallets or user ids' })
  async getPublicShare(@Param('shortId') shortId: string) {
    return this.offramp.getPublicShare(shortId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get offramp status' })
  async getStatus(@Req() req: any, @Param('id') id: string) {
    return this.offramp.getStatus(id, req.user.id);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel offramp — for DEPOSITED state returns CANCELLING so frontend can sign Peer withdrawal' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    return this.offramp.cancelOfframp(id, req.user.id);
  }

  @Post(':id/fund-gas')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund user\'s Base wallet with ETH for gas if below threshold' })
  async fundGas(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { baseWalletAddress: string },
  ) {
    if (!body.baseWalletAddress) throw new BadRequestException('baseWalletAddress is required');
    return this.offramp.fundGas(id, req.user.id, body.baseWalletAddress);
  }

  @Post(':id/mark-cancelled')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark offramp CANCELLED after frontend completes ZKP2P withdrawal + bridge signing' })
  async markCancelled(@Req() req: any, @Param('id') id: string) {
    return this.offramp.markCancelled(id, req.user.id);
  }

  @Post(':id/delete')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a cancelled pay-to-app payment from the owner history' })
  async deleteOfframp(@Req() req: any, @Param('id') id: string) {
    return this.offramp.deleteOfframp(id, req.user.id);
  }
}
