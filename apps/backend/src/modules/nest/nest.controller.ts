import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthGuard, Public } from '@/common/guards';
import { NestService, NestPortfolio, NestProfile, NestTradeView } from './nest.service';
import { NestDepositService } from './nest-deposit.service';
import { XStocksService } from './xstocks.service';
import { ledgerUserId } from './nest-ledger-id';

class UpsertProfileDto {
  @IsIn(['conservative', 'balanced', 'aggressive'])
  riskTolerance: string;

  @IsArray()
  @IsString({ each: true })
  interestTags: string[];

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

class BuildDepositTxDto {
  @IsString()
  userSolanaAddress: string;

  @IsNumber()
  @Min(5)
  @Max(5000)
  amountUsdc: number;
}

class ConfirmDepositDto {
  @IsString()
  userSolanaAddress: string;

  @IsString()
  txHash: string;

  @IsNumber()
  amountUsdc: number;
}

class BuildDevnetDepositTxDto {
  @IsString()
  userSolanaAddress: string;

  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  amountUsdc: number;
}

@ApiTags('nest')
@Controller('nest')
@UseGuards(AuthGuard)
export class NestController {
  constructor(
    private readonly nest: NestService,
    private readonly deposits: NestDepositService,
    private readonly xstocks: XStocksService,
    private readonly config: ConfigService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Whether Nest is currently executing real trades or simulating — drives the "Demo Mode" banner on the frontend' })
  async getConfig(): Promise<{ liveTrading: boolean }> {
    return { liveTrading: this.config.get<string>('NEST_LIVE_TRADING') === 'true' };
  }

  @Get('universe')
  @Public()
  @ApiOperation({ summary: 'Curated investable universe (symbol, name, interest tags) for the onboarding interest picker' })
  async getUniverse() {
    const universe = await this.xstocks.getUniverse();
    return universe.map(a => ({ symbol: a.symbol, name: a.name, underlyingSymbol: a.underlyingSymbol, tags: a.tags }));
  }

  @Get('profile')
  @ApiOperation({ summary: "Caller's Nest profile, or null if they haven't set one up yet. ?demo=true reads the free devnet-USDC demo profile instead of the real one." })
  async getProfile(@Request() req: any, @Query('demo') demo?: string): Promise<NestProfile | null> {
    return this.nest.getProfile(ledgerUserId(req.user.id, demo === 'true'));
  }

  @Post('profile')
  @ApiOperation({ summary: 'Create or update risk tolerance + interest tags — next daily rebalance picks this up. Pass demo:true to set up the devnet-demo profile instead of the real one.' })
  async upsertProfile(@Body() dto: UpsertProfileDto, @Request() req: any): Promise<NestProfile> {
    return this.nest.upsertProfile(ledgerUserId(req.user.id, !!dto.demo), dto.riskTolerance, dto.interestTags, dto.displayName);
  }

  @Get('portfolio')
  @ApiOperation({ summary: 'Current holdings, valuation, P&L, and NAV history for the performance graph. ?demo=true reads the devnet-demo ledger.' })
  async getPortfolio(@Request() req: any, @Query('demo') demo?: string): Promise<NestPortfolio> {
    return this.nest.getPortfolio(ledgerUserId(req.user.id, demo === 'true'));
  }

  @Get('history')
  @ApiOperation({ summary: 'What the rebalance engine bought/sold on the caller\'s behalf, most recent first. ?demo=true reads the devnet-demo ledger.' })
  async getHistory(@Request() req: any, @Query('demo') demo?: string): Promise<NestTradeView[]> {
    return this.nest.getHistory(ledgerUserId(req.user.id, demo === 'true'));
  }

  @Post('deposit/pay-tx')
  @ApiOperation({ summary: 'Build the real mainnet USDC deposit transfer for the caller to sign client-side (gas + treasury ATA rent sponsored)' })
  async buildDepositTx(@Body() dto: BuildDepositTxDto): Promise<{ txBase64: string }> {
    const txBase64 = await this.deposits.buildDepositTx(dto.userSolanaAddress, dto.amountUsdc);
    return { txBase64 };
  }

  @Post('deposit/confirm')
  @ApiOperation({ summary: 'Verify the signed real mainnet deposit on-chain and credit Nest cash — picked up by the next daily rebalance' })
  async confirmDeposit(@Body() dto: ConfirmDepositDto, @Request() req: any): Promise<{ creditedUsd: number }> {
    return this.deposits.confirmDeposit(req.user.id, dto.userSolanaAddress, dto.txHash, dto.amountUsdc);
  }

  @Post('deposit/devnet/pay-tx')
  @ApiOperation({ summary: 'Build a FREE devnet-USDC deposit transfer (no real value) for the caller to sign — lets anyone try Nest with zero financial risk' })
  async buildDevnetDepositTx(@Body() dto: BuildDevnetDepositTxDto): Promise<{ txBase64: string }> {
    const txBase64 = await this.deposits.buildDevnetDepositTx(dto.userSolanaAddress, dto.amountUsdc);
    return { txBase64 };
  }

  @Post('deposit/devnet/confirm')
  @ApiOperation({ summary: 'Verify the signed devnet deposit and credit the devnet-demo ledger only — never the real one' })
  async confirmDevnetDeposit(@Body() dto: ConfirmDepositDto, @Request() req: any): Promise<{ creditedUsd: number }> {
    return this.deposits.confirmDevnetDeposit(req.user.id, dto.userSolanaAddress, dto.txHash, dto.amountUsdc);
  }
}
