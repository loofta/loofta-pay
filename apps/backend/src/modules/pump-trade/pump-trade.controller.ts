import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PumpTradeDto } from './dto/pump-trade.dto';
import { PumpTradeService } from './pump-trade.service';
import { MiniRewardsService } from '@/modules/mini-rewards/mini-rewards.service';
import { JupiterService } from '@/modules/jupiter/jupiter.service';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

@ApiTags('pump-trade')
@Controller('pump')
export class PumpTradeController {
  constructor(
    private readonly pump: PumpTradeService,
    private readonly rewards: MiniRewardsService,
    private readonly jupiter: JupiterService,
  ) {}

  @Post('quote')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(60, 60, 'pump:quote')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Quote a buy or sell of a coin still on the Pump bonding curve (0.30% Loofta fee)' })
  quote(@Req() req: any, @Body() dto: PumpTradeDto) {
    return this.pump.quote(req.user!.id, dto);
  }

  @Post('build')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'pump:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: "Build an unsigned bonding-curve trade for the caller's own wallet. They pay their own network fee and sign it." })
  async build(@Req() req: any, @Body() dto: PumpTradeDto) {
    const res = await this.pump.build(req.user!.id, dto);
    const sell = dto.side === 'sell';
    // Counted for rewards once the signature is confirmed. Never blocks the trade.
    const tradeId = await this.rewards.trackBuilt(req.user!.id, {
      inputMint: sell ? dto.mint : WSOL_MINT,
      outputMint: sell ? WSOL_MINT : dto.mint,
      inAmount: res.inAmount,
      outAmount: res.outAmount,
      feeAmount: res.feeAmount,
      feeBps: res.feeBps,
      feeOwner: this.jupiter.platformFeeWallet?.toBase58() ?? null,
      feeMint: 'SOL',
    });
    return { ...res, tradeId };
  }
}
