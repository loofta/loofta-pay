import { Controller, Post, Body, Req, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { JupiterService } from './jupiter.service';
import { PrepareSolWithdrawalDto } from './dto/prepare-sol-withdrawal.dto';

@ApiTags('jupiter')
@Controller('jupiter')
export class JupiterController {
  constructor(private readonly jupiter: JupiterService) {}

  @Post('prepare-sol-withdrawal')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Quote + build an unsigned USDC -> native SOL swap transaction for withdrawal' })
  async prepare(@Req() req: any, @Body() dto: PrepareSolWithdrawalDto) {
    return this.jupiter.prepareSolWithdrawal(dto.solanaAddress, dto.destinationAddress, dto.amountUSDC);
  }

  @Post('execute')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the user-signed swap transaction to Jupiter for broadcast + confirmation' })
  async execute(@Body() body: { requestId?: string; signedTransaction?: string }) {
    if (!body.requestId || !body.signedTransaction) throw new BadRequestException('requestId and signedTransaction are required');
    return this.jupiter.executeSolWithdrawal(body.requestId, body.signedTransaction);
  }
}
