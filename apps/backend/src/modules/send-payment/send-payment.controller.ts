import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard, OptionalAuthGuard } from '@/common/guards';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { SendPaymentService } from './send-payment.service';
import { CreateSendPaymentDto, ClaimSendPaymentDto } from './dto';
import { SendPaymentLinkPublic } from './entities/send-payment-link.entity';

@ApiTags('send-payment')
@Controller('send-payment')
export class SendPaymentController {
  constructor(private readonly sendPaymentService: SendPaymentService) {}

  @Post('create')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create a send payment link (sender commits funds)' })
  @ApiResponse({
    status: 201,
    description: 'Created',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        link: { type: 'string' },
        deposit_address: { type: 'string' },
        burner_address: { type: 'string', description: 'Empty for PER' },
        amount: { type: 'string' },
        token: { type: 'string' },
        per_recipient_pubkey: { type: 'string' },
        per_mode: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or not configured' })
  async create(
    @PrivyUser() user: { id: string },
    @Body() dto: CreateSendPaymentDto,
  ) {
    return this.sendPaymentService.create(user.id, dto);
  }

  @Get('sponsor-status')
  @ApiOperation({ summary: 'Check if fee sponsorship is configured (SOLANA_FEE_PAYER_PRIVATE_KEY)' })
  @ApiResponse({ status: 200, description: 'Returns { sponsorshipConfigured: boolean }' })
  getSponsorStatus(): { sponsorshipConfigured: boolean } {
    return {
      sponsorshipConfigured: this.sendPaymentService.isSponsorshipConfigured(),
    };
  }

  @Get('my-links')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'List send payment links created by the current user (for recovery after reload)' })
  @ApiResponse({ status: 200, description: 'List of links (id, amount, status, recipient_type, created_at)' })
  async myLinks(@PrivyUser() user: { id: string }) {
    return this.sendPaymentService.listBySender(user.id);
  }

  @Post(':id/build-private-transfer')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({
    summary:
      'Build unsigned MagicBlock private USDC transfer (recipient resolved server-side; not in browser network tab)',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Unsigned tx (MagicBlock response shape)' })
  @ApiResponse({ status: 403, description: 'Not the sender' })
  async buildPrivateTransfer(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Body() body: { sender_wallet: string },
  ) {
    return this.sendPaymentService.buildPrivateTransferForSender(id, user.id, body.sender_wallet);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get public send payment link details (optional auth for is_sender)' })
  @ApiParam({ name: 'id', description: 'Send payment link UUID' })
  @ApiResponse({ status: 200, description: 'Public details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getPublic(@Param('id') id: string, @PrivyUser() user?: { id: string }) {
    return this.sendPaymentService.getPublic(id, user?.id);
  }

  @Post(':id/confirm-funded')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Mark link as funded (sender only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 403, description: 'Not the sender' })
  async confirmFunded(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Body() body: { deposit_tx_hash: string },
  ) {
    return this.sendPaymentService.confirmFunded(
      id,
      body.deposit_tx_hash ?? null,
      user.id,
    );
  }

  @Post(':id/claim')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Claim payment (recipient must log in with matching email/Twitter/username)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description: 'Claimed',
    schema: {
      properties: {
        claim_tx_hash: { type: 'string' },
        amount_received: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not the intended recipient' })
  @ApiResponse({ status: 400, description: 'Already claimed or invalid' })
  async claim(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Body() dto: ClaimSendPaymentDto,
  ) {
    return this.sendPaymentService.claim(id, user.id, dto);
  }

  @Post(':id/reclaim')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({
    summary: 'Reclaim funds (sender only)',
    description: 'OPEN/FUNDED: reclaim all funds and cancel link. CLAIMED: reclaim any leftover in burner(s).',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description: 'Reclaimed',
    schema: {
      properties: {
        reclaim_tx_hash: { type: 'string' },
        amount_reclaimed: { type: 'string', description: 'USDC amount reclaimed' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not the sender' })
  async reclaim(@Param('id') id: string, @PrivyUser() user: { id: string }) {
    return this.sendPaymentService.reclaim(id, user.id);
  }
}
