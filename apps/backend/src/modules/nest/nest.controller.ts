import { Body, Controller, Get, Logger, NotFoundException, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthGuard, Public } from '@/common/guards';
import { NestService, NestPortfolio, NestProfile, NestTradeView, NestLedgerEvent, NestDepositView, NestStreak, NestBacktestSummary } from './nest.service';
import { NestDepositService } from './nest-deposit.service';
import { NestRebalanceService } from './nest-rebalance.service';
import { NestSocialService, NestRoundups, NestFlock } from './nest-social.service';
import { NestSuggestionsService, NestSuggestionView } from './nest-suggestions.service';
import { KalshiService, KalshiMarketView } from './kalshi.service';
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
  @IsNumber()
  @Min(1)
  @Max(100_000_000)
  goalUsd?: number | null;

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

class FaucetDevnetDto {
  @IsString()
  userSolanaAddress: string;
}

class SetRoundupsDto {
  @IsOptional()
  @IsIn([1, 5])
  unit?: number | null;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

class DemoFlagDto {
  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

class FlockVisibilityDto {
  @IsBoolean()
  isPublic: boolean;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

class FlockUsernameDto {
  @IsString()
  username: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

@ApiTags('nest')
@Controller('nest')
@UseGuards(AuthGuard)
export class NestController {
  private readonly logger = new Logger(NestController.name);

  constructor(
    private readonly nest: NestService,
    private readonly deposits: NestDepositService,
    private readonly rebalance: NestRebalanceService,
    private readonly social: NestSocialService,
    private readonly suggestions: NestSuggestionsService,
    private readonly kalshi: KalshiService,
    private readonly xstocks: XStocksService,
    private readonly config: ConfigService,
  ) {}

  // ---- Suggestions (event-triggered, user-approved — never auto-executed) --------------------

  /** Manual trigger — the real cron (nest-cron.service.ts) only fires in production, so without
   *  this there's no way to test the scan on a local dev instance. Safe to expose to any
   *  authenticated caller: it only reads prices and Elfa event data and writes suggestion rows,
   *  never trades. Note: the very first scan on a fresh instance can't find any movers — there's
   *  no prior day's price on record yet to compare against (see nest-suggestions.service.ts). */
  @Post('suggestions/scan')
  @ApiOperation({ summary: 'Manually run the suggestion-detection scan now, instead of waiting for the hourly (production-only) cron. Testing/dev convenience.' })
  async runSuggestionScan(): Promise<{ ran: true }> {
    await this.suggestions.scanForEvents();
    return { ran: true };
  }

  @Get('suggestions')
  @ApiOperation({ summary: "Pending suggested actions (e.g. \"trim TSLA back to target\") from a real, large price move — never auto-executed. ?demo=true reads the devnet-demo ledger." })
  async getSuggestions(@Request() req: any, @Query('demo') demo?: string): Promise<NestSuggestionView[]> {
    return this.suggestions.listForUser(ledgerUserId(req.user.id, demo === 'true'));
  }

  @Post('suggestions/:id/accept')
  @ApiOperation({ summary: 'Execute one suggested action — the only way this feature ever trades. Recomputes the amount fresh at accept-time.' })
  async acceptSuggestion(@Param('id') id: string, @Request() req: any, @Query('demo') demo?: string): Promise<{ executed: boolean }> {
    return this.suggestions.accept(ledgerUserId(req.user.id, demo === 'true'), id);
  }

  @Post('suggestions/:id/dismiss')
  @ApiOperation({ summary: 'Dismiss a suggestion without acting on it.' })
  async dismissSuggestion(@Param('id') id: string, @Request() req: any, @Query('demo') demo?: string): Promise<{ ok: true }> {
    await this.suggestions.dismiss(ledgerUserId(req.user.id, demo === 'true'), id);
    return { ok: true };
  }

  @Get('kalshi')
  @ApiOperation({ summary: "Live Kalshi prediction markets across the companies the caller actually holds — event-shaped (CEO changes, KPI/earnings, product launches), never a price-direction bet and never Loofta's own view. ?demo=true reads the devnet-demo ledger." })
  async getKalshiForHoldings(@Request() req: any, @Query('demo') demo?: string): Promise<Array<KalshiMarketView & { symbol: string }>> {
    const ledgerId = ledgerUserId(req.user.id, demo === 'true');
    const [universe, holdings] = await Promise.all([this.xstocks.getUniverse(), this.nest.getPortfolio(ledgerId)]);
    const held = holdings.holdings.filter(h => h.symbol !== 'USD' && (h.valueUsd ?? 0) > 0).map(h => h.symbol);
    const assets = universe.filter(a => held.includes(a.symbol)).slice(0, 8); // cap fan-out per request
    const out: Array<KalshiMarketView & { symbol: string }> = [];
    for (const asset of assets) {
      const markets = await this.kalshi.getMarketsForCompany(asset.name, asset.underlyingSymbol);
      for (const m of markets.slice(0, 2)) out.push({ ...m, symbol: asset.symbol });
    }
    return out;
  }

  @Get('kalshi/:symbol')
  @Public()
  @ApiOperation({ summary: 'Live, real Kalshi prediction markets on this company (CEO changes, KPI/earnings, product launches — event-shaped, never a price-direction bet) — never Loofta\'s own view, just a link to a real market. Same for every caller, so no auth needed.' })
  async getKalshiMarkets(@Param('symbol') symbol: string): Promise<KalshiMarketView[]> {
    const universe = await this.xstocks.getUniverse();
    const asset = universe.find(a => a.symbol === symbol);
    if (!asset) return [];
    return this.kalshi.getMarketsForCompany(asset.name, asset.underlyingSymbol);
  }

  // ---- Crumbs (round-ups) ---------------------------------------------------------------------

  @Get('roundups')
  @ApiOperation({ summary: 'Pending round-up "crumbs" from payments the caller has sent since they last fed the nest. ?demo=true reads the devnet-demo profile.' })
  async getRoundups(@Request() req: any, @Query('demo') demo?: string): Promise<NestRoundups> {
    return this.social.getRoundups(req.user.id, ledgerUserId(req.user.id, demo === 'true'));
  }

  @Post('roundups')
  @ApiOperation({ summary: 'Turn round-ups on (unit 1 or 5) or off (unit null). Enabling starts counting from now.' })
  async setRoundups(@Body() dto: SetRoundupsDto, @Request() req: any): Promise<NestRoundups> {
    return this.social.setRoundups(req.user.id, ledgerUserId(req.user.id, !!dto.demo), dto.unit ?? null);
  }

  @Post('roundups/sweep')
  @ApiOperation({ summary: 'Mark pending crumbs as fed — call after the crumbs-prefilled deposit confirms.' })
  async sweepRoundups(@Body() dto: DemoFlagDto, @Request() req: any): Promise<NestRoundups> {
    return this.social.sweepRoundups(req.user.id, ledgerUserId(req.user.id, !!dto.demo));
  }

  // ---- Flock ----------------------------------------------------------------------------------

  @Get('flock')
  @ApiOperation({ summary: 'Nests the caller follows (category %, level, streak — never balances), plus their own visibility and kudos.' })
  async getFlock(@Request() req: any, @Query('demo') demo?: string): Promise<NestFlock> {
    return this.social.getFlock(req.user.id, demo === 'true');
  }

  @Post('flock/visibility')
  @ApiOperation({ summary: 'Opt the caller\'s nest in/out of being followable.' })
  async setFlockVisibility(@Body() dto: FlockVisibilityDto, @Request() req: any): Promise<{ isPublic: boolean }> {
    return this.social.setPublic(ledgerUserId(req.user.id, !!dto.demo), dto.isPublic);
  }

  @Post('flock/follow')
  @ApiOperation({ summary: 'Follow a Loofta user\'s nest by username (they must have opted in).' })
  async followNest(@Body() dto: FlockUsernameDto, @Request() req: any): Promise<{ ok: true }> {
    return this.social.follow(req.user.id, dto.username, !!dto.demo);
  }

  @Post('flock/unfollow')
  @ApiOperation({ summary: 'Stop following a nest.' })
  async unfollowNest(@Body() dto: FlockUsernameDto, @Request() req: any): Promise<{ ok: true }> {
    return this.social.unfollow(req.user.id, dto.username);
  }

  @Post('flock/kudos')
  @ApiOperation({ summary: 'Send one kudos per day to a nest you follow.' })
  async sendKudos(@Body() dto: FlockUsernameDto, @Request() req: any): Promise<{ ok: true }> {
    return this.social.kudos(req.user.id, dto.username, !!dto.demo);
  }

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Whether Nest is currently executing real trades or simulating — drives the "Demo Mode" banner on the frontend' })
  async getConfig(): Promise<{ liveTrading: boolean }> {
    return { liveTrading: this.config.get<string>('NEST_LIVE_TRADING') === 'true' };
  }

  @Get('backtest')
  @Public()
  @ApiOperation({ summary: 'Latest committed backtest summary (scripts/nest-backtest) — historical, not a forecast. 404 until a run has been committed.' })
  getBacktest(): NestBacktestSummary {
    // ts-node/--watch runs from src/, the prod build from dist/ (nest-cli copies modules/nest/*.json
    // there) — check both, plus a cwd-relative path for anything that runs from the repo root.
    const candidates = [
      join(__dirname, 'backtest-summary.json'),
      join(process.cwd(), 'src/modules/nest/backtest-summary.json'),
      join(process.cwd(), 'apps/backend/src/modules/nest/backtest-summary.json'),
    ];
    const file = candidates.find(p => existsSync(p));
    if (!file) throw new NotFoundException('No backtest summary committed yet');
    return JSON.parse(readFileSync(file, 'utf8')) as NestBacktestSummary;
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
    return this.nest.upsertProfile(ledgerUserId(req.user.id, !!dto.demo), dto.riskTolerance, dto.interestTags, dto.displayName, dto.goalUsd);
  }

  @Get('deposits')
  @ApiOperation({ summary: "Caller's deposit history, most recent first. ?demo=true reads the devnet-demo ledger." })
  async getDeposits(@Request() req: any, @Query('demo') demo?: string): Promise<NestDepositView[]> {
    return this.nest.getDeposits(ledgerUserId(req.user.id, demo === 'true'));
  }

  @Get('streak')
  @ApiOperation({ summary: 'Weekly deposit streak (with one forgiven skip per rolling 4 weeks). ?demo=true reads the devnet-demo ledger.' })
  async getStreak(@Request() req: any, @Query('demo') demo?: string): Promise<NestStreak> {
    return this.nest.getStreak(ledgerUserId(req.user.id, demo === 'true'));
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

  @Get('ledger')
  @ApiOperation({ summary: 'The caller\'s own real trades (one per recently-traded symbol) paired with the most recent real elfa-sourced X post about that ticker. ?demo=true reads the devnet-demo ledger.' })
  async getLedger(@Request() req: any, @Query('demo') demo?: string): Promise<NestLedgerEvent[]> {
    return this.nest.getLedger(ledgerUserId(req.user.id, demo === 'true'));
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

  @Post('deposit/devnet/faucet')
  @ApiOperation({ summary: 'One-time treasury-funded devnet-USDC grant to the caller\'s own wallet — a fresh wallet has none, so this is what the deposit step actually transfers. Real on-chain transfer, devnet only, no real value.' })
  async faucetDevnetUsdc(@Body() dto: FaucetDevnetDto): Promise<{ txHash: string; amountUsdc: number }> {
    return this.deposits.fundDevnetFaucet(dto.userSolanaAddress);
  }

  @Post('deposit/devnet/pay-tx')
  @ApiOperation({ summary: 'Build a FREE devnet-USDC deposit transfer (no real value) for the caller to sign — lets anyone try Nest with zero financial risk' })
  async buildDevnetDepositTx(@Body() dto: BuildDevnetDepositTxDto): Promise<{ txBase64: string }> {
    const txBase64 = await this.deposits.buildDevnetDepositTx(dto.userSolanaAddress, dto.amountUsdc);
    return { txBase64 };
  }

  @Post('deposit/devnet/confirm')
  @ApiOperation({ summary: 'Verify the signed devnet deposit, credit the devnet-demo ledger, and immediately run that account\'s rebalance so the basket is built without waiting for the (production-only, once-daily) cron' })
  async confirmDevnetDeposit(@Body() dto: ConfirmDepositDto, @Request() req: any): Promise<{ creditedUsd: number }> {
    const result = await this.deposits.confirmDevnetDeposit(req.user.id, dto.userSolanaAddress, dto.txHash, dto.amountUsdc);
    // Devnet-demo only, scoped to this one caller — the real daily cron (nest-cron.service.ts)
    // is production-gated and once-daily, so without this a fresh deposit would just sit as cash
    // until whenever that next runs (or never, on a local dev instance). A rebalance failure here
    // shouldn't fail the deposit itself — the money's already safely credited either way.
    try {
      await this.rebalance.runDemoRebalanceForUser(ledgerUserId(req.user.id, true));
    } catch (e: any) {
      this.logger.error(`post-deposit runDemoRebalanceForUser failed: ${e.message}`);
    }
    return result;
  }
}
