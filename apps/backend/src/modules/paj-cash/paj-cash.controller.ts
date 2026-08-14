import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Public } from '@/common/guards';
import { PajCashService, PajApiError } from './paj-cash.service';
import { PajCashSessionService, PajLinkRequiredError } from './paj-cash-session.service';
import { PajCashBankService } from './paj-cash-bank.service';
import { PajCashOrdersService, PajKycRequiredError } from './paj-cash-orders.service';
import { LinkAccountDto } from './dto/link-account.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SaveBankAccountDto } from './dto/save-bank-account.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { CreateOnrampDto } from './dto/create-onramp.dto';
import { CreateOfframpDto } from './dto/create-offramp.dto';
import { ConfirmSentDto } from './dto/confirm-sent.dto';
import { PAJ_STATIC_BANKS } from './paj-banks-static';

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Converts internal PAJ Cash errors into the specific HTTP shapes the frontend branches on. */
function rethrowAsHttp(err: unknown): never {
  if (err instanceof PajLinkRequiredError) {
    throw new ConflictException({ code: 'PAJ_LINK_REQUIRED', message: err.message });
  }
  if (err instanceof PajKycRequiredError) {
    throw new BadRequestException({ code: 'KYC_REQUIRED', message: err.message });
  }
  if (err instanceof PajApiError) {
    throw new BadRequestException({ code: 'PAJ_API_ERROR', message: err.message });
  }
  throw err;
}

@ApiTags('paj-cash')
@Controller('paj-cash')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class PajCashController {
  constructor(
    private readonly pajCash: PajCashService,
    private readonly session: PajCashSessionService,
    private readonly bank: PajCashBankService,
    private readonly orders: PajCashOrdersService,
  ) {}

  @Post('link/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a PAJ Cash OTP to the given email or phone' })
  async linkInitiate(@Body() dto: LinkAccountDto) {
    try {
      await this.session.initiate(dto.recipient);
      return { sent: true };
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('link/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the OTP and establish a PAJ Cash session for this user' })
  async linkVerify(@Req() req: any, @Body() dto: VerifyOtpDto) {
    try {
      const { expiresAt } = await this.session.verify(req.user.id, dto.recipient, dto.otp, {
        uuid: dto.deviceUuid,
        device: 'Web',
        os: dto.os,
        browser: dto.browser,
      });
      return { linked: true, expiresAt };
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('link/status')
  @ApiOperation({ summary: 'Is the current user linked to PAJ Cash, and what is their known KYC status?' })
  async linkStatus(@Req() req: any) {
    return this.session.getStatus(req.user.id);
  }

  @Get('rate')
  @ApiOperation({ summary: 'Current PAJ on-ramp/off-ramp rates' })
  async rate() {
    try {
      return await this.pajCash.getRate();
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('public-rate')
  @Public()
  @ApiOperation({ summary: 'Current PAJ off-ramp rate (public, no auth) — for SEO/marketing rate pages' })
  async publicRate() {
    try {
      const { offRampRate } = await this.pajCash.getRate();
      return offRampRate;
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('value')
  @ApiOperation({ summary: 'Live USDC<->fiat quote for an on-ramp or off-ramp amount' })
  async value(
    @Req() req: any,
    @Query('direction') direction: 'onramp' | 'offramp',
    @Query('amount') amount: string,
    @Query('currency') currency = 'NGN',
  ) {
    const amountNum = Number(amount);
    if (!(amountNum > 0)) throw new BadRequestException('amount must be greater than 0');
    try {
      if (direction === 'offramp') {
        const token = await this.session.getValidSessionToken(req.user.id);
        return await this.pajCash.getOfframpValue(token, amountNum, SOLANA_USDC_MINT, currency);
      }
      // On-ramp: the caller now enters the USDC amount they want, but PAJ's onramp-value
      // endpoint only converts fiat->token (no token->fiat variant for the onramp rate — see
      // `getOfframpValue` above, which uses the *offramp* rate and would give the wrong number
      // here). Approximate with the plain onRampRate from `/pub/rate` instead; the authoritative
      // fiatAmount is whatever PAJ returns when the order is actually created.
      const rates = await this.pajCash.getRate();
      const fiatAmount = Math.round(amountNum * rates.onRampRate.rate * 100) / 100;
      return { amount: amountNum, fiatAmount, mint: SOLANA_USDC_MINT, currency, rate: rates.onRampRate.rate };
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('banks')
  @ApiOperation({ summary: 'List Nigerian banks supported by PAJ' })
  async banks() {
    // Served from a static, manually-refreshed snapshot instead of a live per-request call to
    // PAJ (which required a per-user session round-trip and was the source of slow load times
    // in the bank picker) — this is reference data that changes rarely. See paj-banks-static.ts.
    return PAJ_STATIC_BANKS;
  }

  @Get('public-banks')
  @Public()
  @ApiOperation({ summary: 'List Nigerian banks supported by PAJ (public, no auth) — for SEO/marketing pages' })
  async publicBanks() {
    return PAJ_STATIC_BANKS;
  }

  @Get('bank-account/confirm')
  @ApiOperation({ summary: 'Resolve an account number to its holder name before saving' })
  async confirmBankAccount(@Req() req: any, @Query('bankId') bankId: string, @Query('accountNumber') accountNumber: string) {
    if (!bankId || !accountNumber) throw new BadRequestException('bankId and accountNumber are required');
    try {
      return await this.bank.confirmAccount(req.user.id, bankId, accountNumber);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('bank-account')
  @ApiOperation({ summary: 'Save a bank account for future off-ramp orders' })
  async saveBankAccount(@Req() req: any, @Body() dto: SaveBankAccountDto) {
    try {
      return await this.bank.saveAccount(req.user.id, dto.bankId, dto.bankName, dto.accountNumber);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('bank-account')
  @ApiOperation({ summary: 'List saved bank accounts for the current user' })
  async listBankAccounts(@Req() req: any) {
    return this.bank.listSavedAccounts(req.user.id);
  }

  @Patch('bank-account/:id/default')
  @ApiOperation({ summary: 'Mark a saved bank account as the default Naira payout destination' })
  async setDefaultBankAccount(@Req() req: any, @Param('id') id: string) {
    try {
      return await this.bank.setDefaultAccount(req.user.id, id);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('kyc')
  @ApiOperation({ summary: 'Submit BVN/NIN KYC — only called reactively after a KYC_REQUIRED order error' })
  async submitKyc(@Req() req: any, @Body() dto: SubmitKycDto) {
    try {
      const token = await this.session.getValidSessionToken(req.user.id);
      const result = await this.pajCash.submitKyc(token, dto.idNumber, dto.idType, dto.country ?? 'NG');
      await this.session.setKycStatus(req.user.id, 'pending', dto.idType);
      return result;
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('onramp')
  @ApiOperation({ summary: 'Create an on-ramp order (top up balance with Naira)' })
  async createOnramp(@Req() req: any, @Body() dto: CreateOnrampDto) {
    try {
      return await this.orders.createOnramp(req.user.id, dto);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('offramp')
  @ApiOperation({ summary: 'Create an off-ramp order (withdraw balance to Naira)' })
  async createOfframp(@Req() req: any, @Body() dto: CreateOfframpDto) {
    try {
      return await this.orders.createOfframp(req.user.id, dto);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Post('offramp/:id/confirm-sent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report that the on-chain USDC send for an off-ramp order succeeded' })
  async confirmSent(@Req() req: any, @Param('id') id: string, @Body() dto: ConfirmSentDto) {
    try {
      return await this.orders.confirmOfframpSent(req.user.id, id, dto.txSignature);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  @Get('orders')
  @ApiOperation({ summary: 'PAJ Cash order history for the current user' })
  async listOrders(@Req() req: any) {
    return this.orders.listOrders(req.user.id);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Single order status — refreshes from PAJ if non-terminal and stale' })
  async getOrder(@Req() req: any, @Param('id') id: string) {
    try {
      return await this.orders.getOrder(req.user.id, id);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }
}
