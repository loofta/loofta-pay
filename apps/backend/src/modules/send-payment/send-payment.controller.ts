import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
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
        burner_address: { type: 'string', description: 'Burner wallet pubkey (for one-click Pay with Phantom)' },
        amount: { type: 'string' },
        token: { type: 'string' },
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

  @Post(':id/prepare-private')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Prepare private (Privacy Cash vault) payment — returns unsigned tx to sign' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Unsigned deposit tx + activityId + passphrase' })
  @ApiResponse({ status: 400, description: 'Private payments not configured or prepare failed' })
  async preparePrivate(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Headers('x-session-signature') sessionSignature: string,
    @Body() body: { sender_public_key: string; use_sponsor?: boolean },
  ) {
    if (!sessionSignature || !body.sender_public_key) {
      throw new BadRequestException('Missing x-session-signature header or sender_public_key');
    }
    return this.sendPaymentService.preparePrivate(
      id,
      user.id,
      body.sender_public_key,
      sessionSignature,
      body.use_sponsor === true,
    );
  }

  @Post(':id/submit-private')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Submit signed private deposit tx and mark link as funded' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Updated' })
  async submitPrivate(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Headers('x-session-signature') sessionSignature: string,
    @Body()
    body: {
      signed_deposit_tx: string;
      activity_id: string;
      sender_public_key: string;
      last_valid_block_height?: number;
      passphrase: string;
      /** Optional: signed SOL tx (sender → burner) for claim gas; base64. */
      signed_sol_tx?: string;
    },
  ) {
    if (!sessionSignature || !body.signed_deposit_tx || !body.activity_id || !body.sender_public_key || !body.passphrase) {
      throw new BadRequestException('Missing required fields or x-session-signature');
    }
    return this.sendPaymentService.submitPrivate(
      id,
      user.id,
      {
        signedDepositTx: body.signed_deposit_tx,
        activityId: body.activity_id,
        senderPublicKey: body.sender_public_key,
        lastValidBlockHeight: body.last_valid_block_height,
        passphrase: body.passphrase,
        signedSolTx: body.signed_sol_tx,
      },
      sessionSignature,
    );
  }

  @Post(':id/private/signed-tx')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get fully signed deposit tx (add sponsor sig) for frontend to send' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'signed_deposit_tx (base64)' })
  async getSignedTxForPrivate(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Headers('x-session-signature') sessionSignature: string,
    @Body()
    body: {
      signed_deposit_tx: string;
      activity_id: string;
      sender_public_key: string;
      last_valid_block_height?: number;
      passphrase: string;
    },
  ) {
    if (!sessionSignature || !body.signed_deposit_tx || !body.activity_id || !body.sender_public_key || !body.passphrase) {
      throw new BadRequestException('Missing required fields or x-session-signature');
    }
    return this.sendPaymentService.getSignedTxForPrivate(
      id,
      user.id,
      {
        signedDepositTx: body.signed_deposit_tx,
        activityId: body.activity_id,
        senderPublicKey: body.sender_public_key,
        lastValidBlockHeight: body.last_valid_block_height,
        passphrase: body.passphrase,
      },
      sessionSignature,
    );
  }

  @Post(':id/private/complete')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Complete private claim after frontend sent the deposit tx' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Updated' })
  async completePrivateWithSignature(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Headers('x-session-signature') sessionSignature: string,
    @Body()
    body: {
      deposit_tx_signature: string;
      activity_id: string;
      sender_public_key: string;
      last_valid_block_height?: number;
      passphrase: string;
    },
  ) {
    if (!sessionSignature || !body.deposit_tx_signature || !body.activity_id || !body.sender_public_key || !body.passphrase) {
      throw new BadRequestException('Missing required fields or x-session-signature');
    }
    return this.sendPaymentService.completePrivateWithSignature(
      id,
      user.id,
      {
        depositTxSignature: body.deposit_tx_signature,
        activityId: body.activity_id,
        senderPublicKey: body.sender_public_key,
        lastValidBlockHeight: body.last_valid_block_height,
        passphrase: body.passphrase,
      },
      sessionSignature,
    );
  }

  @Post(':id/claim')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Claim payment (recipient must log in with matching email/Twitter)' })
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
