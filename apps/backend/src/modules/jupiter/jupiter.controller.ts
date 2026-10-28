import { Controller, Post, Get, Body, Query, Req, UseGuards, HttpCode, HttpStatus, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { UsersService } from '@/modules/users/users.service';
import { JupiterService } from './jupiter.service';
import { PrepareSolWithdrawalDto } from './dto/prepare-sol-withdrawal.dto';
import { JupiterSwapDto, JupiterSwapSubmitDto } from './dto/jupiter-swap.dto';

@ApiTags('jupiter')
@Controller('jupiter')
export class JupiterController {
  constructor(
    private readonly jupiter: JupiterService,
    private readonly usersService: UsersService,
  ) {}

  @Post('prepare-sol-withdrawal')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Quote + build an unsigned USDC -> native SOL swap transaction for withdrawal' })
  async prepareWithdrawal(@Req() req: any, @Body() dto: PrepareSolWithdrawalDto) {
    // solanaAddress is the wallet the fee payer tops up with real SOL before the swap — must be
    // the caller's own wallet, or anyone could drain the fee payer by repeatedly requesting a
    // top-up to a fresh throwaway address.
    const isOwnWallet = await this.usersService.isSolanaAddressInLinkedAccounts(req.user!.id, dto.solanaAddress);
    if (!isOwnWallet) {
      throw new ForbiddenException('solanaAddress must be one of your own linked wallets');
    }
    return this.jupiter.prepareSolWithdrawal(dto.solanaAddress, dto.destinationAddress, dto.amountUSDC);
  }

  @Post('execute')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the user-signed swap transaction to Jupiter for broadcast + confirmation' })
  async execute(@Body() body: { requestId?: string; signedTransaction?: string }) {
    if (!body.requestId || !body.signedTransaction) throw new BadRequestException('requestId and signedTransaction are required');
    return this.jupiter.executeSwap(body.requestId, body.signedTransaction);
  }

  @Post('swap/quote')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(60, 60, 'jupiter:quote')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Quote a token swap (0.80% Loofta fee already deducted from the output)' })
  async quoteSwap(@Req() req: any, @Body() dto: JupiterSwapDto) {
    return this.jupiter.quoteSwap(req.user!.id, dto);
  }

  @Post('swap/build')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'jupiter:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build a sponsored (gasless) token swap transaction for the caller\'s own wallet' })
  async buildSwap(@Req() req: any, @Body() dto: JupiterSwapDto) {
    return this.jupiter.buildSwap(req.user!.id, dto);
  }

  @Post('swap/submit')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'jupiter:submit')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Co-sign (sponsor) and send a swap the user signed. Only a transaction we built is accepted.' })
  async submitSwap(@Req() req: any, @Body() dto: JupiterSwapSubmitDto) {
    return this.jupiter.submitSwap(req.user!.id, dto);
  }
}
