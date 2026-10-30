import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { parseEmvcoQr, QrParseError } from './emvco';

@ApiTags('qr-pay')
@Controller('qr-pay')
export class QrPayController {
  @Post('decode')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decode a merchant QR (PIX, PromptPay, VietQR, QR Ph, QRIS, SGQR) into payee details' })
  decode(@Body() body: { payload?: string }) {
    if (typeof body?.payload !== 'string' || !body.payload) throw new BadRequestException('payload is required');
    try {
      return parseEmvcoQr(body.payload);
    } catch (e) {
      if (e instanceof QrParseError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
