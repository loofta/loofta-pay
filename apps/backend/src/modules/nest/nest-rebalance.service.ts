import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { SupabaseService } from '@/database/supabase.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { XStocksService, NestUniverseAsset } from './xstocks.service';
import { NestRiskTolerance } from './nest.service';
import { isDemoLedgerUserId } from './nest-ledger-id';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v2';

interface RiskConfig {
  maxWeightPerPosition: number; // only binds when interest tags narrow the basket to a handful of names
  maxDailyTurnoverPct: number; // fraction of a user's own NAV that can move in one rebalance tick
  cashFloorPct: number; // fraction always left as uninvested "USD" cash
}

const RISK_CONFIG: Record<NestRiskTolerance, RiskConfig> = {
  conservative: { maxWeightPerPosition: 0.15, maxDailyTurnoverPct: 0.05, cashFloorPct: 0.1 },
  balanced: { maxWeightPerPosition: 0.2, maxDailyTurnoverPct: 0.1, cashFloorPct: 0.05 },
  aggressive: { maxWeightPerPosition: 0.3, maxDailyTurnoverPct: 0.2, cashFloorPct: 0 },
};

const MIN_USER_TRADE_USD = 2; // skip a per-user delta smaller than this — not worth a ledger row
const MIN_NET_TRADE_USD = 5; // skip an aggregate (netted-across-users) trade smaller than this

interface UserProfile {
  userId: string;
  riskTolerance: NestRiskTolerance;
  interestTags: string[];
}

interface HoldingRow {
  userId: string;
  symbol: string;
  units: number;
  avgCostUsd: number;
}

@Injectable()
export class NestRebalanceService {
  private readonly logger = new Logger(NestRebalanceService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly xstocks: XStocksService,
  ) {}

  private isLiveTrading(): boolean {
    return this.config.get<string>('NEST_LIVE_TRADING') === 'true';
  }

  private maxTradeUsdPerSymbolPerDay(): number {
    const raw = Number(this.config.get<string>('NEST_MAX_TRADE_USD_PER_SYMBOL_PER_DAY'));
    return Number.isFinite(raw) && raw > 0 ? raw : 500;
  }

  /** Target weight per symbol for one profile: equal-weight across every symbol matching the
   *  profile's interest tags (untagged profile = whole universe), capped at the risk tier's
   *  per-position ceiling, with the risk tier's cash floor held back.
   *
   *  Previously this ranked candidates by an Elfa attention/mention-volume score, tilted weight
   *  toward high scorers, and used a hysteresis band to limit churn from rank-flicker. A 26-week
   *  backtest against real Elfa data (scripts/nest-backtest, RESULTS.md, 2026-09-21) showed that
   *  approach — with hysteresis, the best version of it — still lost to plain equal-weight by 3.2
   *  points net, and sat at only the 59th percentile of a 200-shuffle placebo test (statistically
   *  indistinguishable from noise). A second variant, ranking by attention for SELECTION only
   *  (equal-weighted within the top pick), also lost to full equal-weight by ~11 points. Elfa's
   *  own guidance (asked directly, 2026-09-21) confirms mention-volume on individual equities is
   *  a reactive/retail-attention signal, not a validated alpha signal, and recommends shipping
   *  equal-weight as the default policy with social data used only as a risk/event monitoring
   *  layer — not as a portfolio-weight input. Deterministic and side-effect free so it can be
   *  unit tested and reused for the onboarding "preview my basket" endpoint later. */
  computeTargetWeights(profile: UserProfile, universe: NestUniverseAsset[]): Map<string, number> {
    const cfg = RISK_CONFIG[profile.riskTolerance];
    const candidates = profile.interestTags.length > 0 ? universe.filter(a => a.tags.some(t => profile.interestTags.includes(t))) : universe;
    if (candidates.length === 0) return new Map();

    const investableFraction = 1 - cfg.cashFloorPct;
    const equalWeight = investableFraction / candidates.length;

    const weights = new Map<string, number>();
    for (const a of candidates) {
      weights.set(a.symbol, Math.min(equalWeight, cfg.maxWeightPerPosition));
    }
    // Capping can leave weights summing to less than investableFraction — the shortfall simply
    // stays uninvested as extra cash rather than being redistributed, which is a safe (if not
    // perfectly capital-efficient) outcome for an MVP allocator.
    return weights;
  }

  private getTreasuryKeypair(): Keypair {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    return Keypair.fromSecretKey(bs58.decode(feePayerKey));
  }

  /** Treasury-signed Jupiter swap of its own funds — never a client-supplied transaction, so none
   *  of the ATA-sponsorship-drain / intent-binding machinery in solana-sponsor.service.ts applies
   *  (that class of attack requires an untrusted caller supplying the transaction; here the
   *  treasury is both the taker and the sole signer of its own trade). Real risk here is a bad
   *  calc trading too much — that's bounded by maxTradeUsdPerSymbolPerDay at the call site. */
  /**
   * CAVEAT — verify before ever setting NEST_LIVE_TRADING=true: xStock mints use the Token-2022
   * "Scaled UI Amount" extension (a display multiplier on top of raw decimals). `getMint`'s
   * `.decimals` fixes the 8-vs-6 sizing bug this file had, but a sell amount derived from a UI
   * quantity may still need to go through that multiplier (not just 10**decimals) to produce the
   * correct raw amount Jupiter expects — this needs a real testnet/small-mainnet trade to confirm
   * before trusting it with real treasury funds. Buys are less exposed (input is USDC, a plain
   * 6-decimal mint) — the risk is specifically in `unitsToSell`'s raw-amount conversion below.
   */
  private async executeTreasurySwap(inputMint: string, outputMint: string, amountAtomicIn: bigint): Promise<{ txSignature: string; outAmountAtomic: bigint }> {
    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    if (!apiKey) throw new Error('JUPITER_API_KEY not configured — cannot execute live Nest trades');
    const treasury = this.getTreasuryKeypair();

    const params = new URLSearchParams({ inputMint, outputMint, amount: amountAtomicIn.toString(), taker: treasury.publicKey.toBase58(), slippageBps: '150' });
    const orderRes = await fetch(`${JUPITER_API_BASE}/order?${params.toString()}`, { headers: { 'x-api-key': apiKey } });
    if (!orderRes.ok) throw new Error(`Jupiter order failed (${orderRes.status}): ${(await orderRes.text()).slice(0, 300)}`);
    const order = await orderRes.json();
    if (!order.transaction) throw new Error(order.errorMessage || 'Jupiter did not return a transaction to sign');

    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    tx.sign([treasury]);
    const signedBase64 = Buffer.from(tx.serialize()).toString('base64');

    const execRes = await fetch(`${JUPITER_API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ signedTransaction: signedBase64, requestId: order.requestId }),
    });
    if (!execRes.ok) throw new Error(`Jupiter execute failed (${execRes.status}): ${(await execRes.text()).slice(0, 300)}`);
    const result = await execRes.json();
    if (result.status !== 'Success') throw new Error(result.error || 'Nest trade failed to land on-chain');
    return { txSignature: result.signature, outAmountAtomic: BigInt(order.outAmount ?? 0) };
  }

  /** Sum of USDC + every xStock position the treasury actually holds on-chain, at current
   *  prices — the "real" side of the solvency check against the ledger's claimed total. */
  private async getTreasuryOnChainValueUsd(universe: NestUniverseAsset[], prices: Map<string, number>): Promise<number> {
    const conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    const treasury = this.getTreasuryKeypair().publicKey;
    let total = 0;
    const usdcAta = await getAssociatedTokenAddress(new PublicKey(USDC_MINT), treasury);
    try {
      total += Number((await conn.getTokenAccountBalance(usdcAta)).value.uiAmount ?? 0);
    } catch {
      /* no USDC ATA yet = 0 */
    }
    for (const asset of universe) {
      try {
        const ata = await getAssociatedTokenAddress(new PublicKey(asset.solanaMint), treasury, false, TOKEN_2022_PROGRAM_ID);
        const bal = await conn.getTokenAccountBalance(ata);
        const price = prices.get(asset.symbol) ?? 0;
        total += Number(bal.value.uiAmount ?? 0) * price;
      } catch {
        /* no position in this symbol yet = 0 */
      }
    }
    return total;
  }

  /**
   * Daily cash-deployment pass, NOT auto-rebalancing (2026-09-21 pivot): computes each opted-in
   * user's equal-weight target basket and buys toward it with whatever idle cash they have — a
   * fresh deposit becomes a basket — but never sells an existing position to correct drift from
   * a price move. Nets every user's buy for the same symbol into one treasury-level trade
   * (minimizes swap count/fees vs. trading per-user), executes (or simulates) it, then fans the
   * fill back out into each user's own ledger proportional to their share of that symbol's net
   * delta. Trimming an overweight position only ever happens through an explicitly accepted
   * suggestion (nest-suggestions.service.ts).
   */
  async runDailyRebalance(): Promise<void> {
    if (this.running) {
      this.logger.warn('runDailyRebalance already in progress — skipping this tick');
      return;
    }
    this.running = true;
    try {
      await this.doRun();
    } finally {
      this.running = false;
    }
  }

  private async doRun(): Promise<void> {
    const db = this.supabase.getClient();
    const universe = await this.xstocks.getUniverse();
    if (universe.length === 0) {
      this.logger.error('Nest universe is empty (Backed API unreachable?) — skipping this rebalance cycle');
      return;
    }

    const prices = await this.xstocks.getPrices(universe.map(a => a.symbol));

    const liveTrading = this.isLiveTrading();
    if (!liveTrading) {
      this.logger.warn('NEST_LIVE_TRADING is not "true" — this rebalance run will SIMULATE fills at current price, not execute real trades. Ledger + portfolio API will reflect this via /nest/config.liveTrading.');
    } else {
      const treasuryValueUsd = await this.getTreasuryOnChainValueUsd(universe, prices);
      // Devnet-demo rows (free devnet USDC, no real value) are excluded — they never correspond
      // to anything the treasury actually holds, so including them would make a real solvency
      // check fail against fake money. See nest-ledger-id.ts.
      const { data: allHoldings } = await db.from('nest_holdings').select('user_id, units, avg_cost_usd, symbol');
      const ledgerClaimedUsd = (allHoldings ?? [])
        .filter(h => !isDemoLedgerUserId(h.user_id))
        .reduce((sum, h) => sum + Number(h.units) * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? Number(h.avg_cost_usd)), 0);
      if (treasuryValueUsd < ledgerClaimedUsd * 0.98) {
        this.logger.error(`SOLVENCY CHECK FAILED: treasury on-chain value $${treasuryValueUsd.toFixed(2)} is below ledger-claimed $${ledgerClaimedUsd.toFixed(2)} by more than 2% — aborting this rebalance run without trading. Needs manual investigation before the next cycle runs live.`);
        return;
      }
    }

    const { data: profileRows, error: profileErr } = await db.from('nest_profiles').select('user_id, risk_tolerance, interest_tags');
    if (profileErr) {
      this.logger.error(`load profiles: ${profileErr.message}`);
      return;
    }
    const profiles: UserProfile[] = (profileRows ?? []).map(r => ({ userId: r.user_id, riskTolerance: r.risk_tolerance, interestTags: r.interest_tags ?? [] }));
    if (profiles.length === 0) return;

    // Devnet-demo profiles (ledger id suffixed, see nest-ledger-id.ts) NEVER feed into the real
    // netted-aggregate below — that aggregate is what actually gets traded when liveTrading is
    // on. A demo user's fake balance contributing to it would mean the treasury trades MORE real
    // money than real users alone needed, and a slice of that real fill would land back in a
    // fake account. Demo users get their own always-simulated pass further down instead.
    const realProfiles = profiles.filter(p => !isDemoLedgerUserId(p.userId));
    const demoProfiles = profiles.filter(p => isDemoLedgerUserId(p.userId));

    const { data: holdingRows, error: holdingsErr } = await db.from('nest_holdings').select('user_id, symbol, units, avg_cost_usd');
    if (holdingsErr) {
      this.logger.error(`load holdings: ${holdingsErr.message}`);
      return;
    }
    const holdingsByUser = new Map<string, HoldingRow[]>();
    for (const r of holdingRows ?? []) {
      const row: HoldingRow = { userId: r.user_id, symbol: r.symbol, units: Number(r.units), avgCostUsd: Number(r.avg_cost_usd) };
      if (!holdingsByUser.has(row.userId)) holdingsByUser.set(row.userId, []);
      holdingsByUser.get(row.userId)!.push(row);
    }

    // Per-user target deltas, capped at that user's own daily-turnover limit. Aggregated per
    // symbol so the actual swap size reflects every user's contribution netted together.
    const netDeltaUsdBySymbol = new Map<string, number>();
    const userDeltasBySymbol = new Map<string, Array<{ userId: string; deltaUsd: number }>>();

    for (const profile of realProfiles) {
      const holdings = holdingsByUser.get(profile.userId) ?? [];
      const navUsd = holdings.reduce((sum, h) => sum + h.units * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? h.avgCostUsd), 0);
      if (navUsd <= 0) continue; // never deposited — nothing to allocate yet

      const targetWeights = this.computeTargetWeights(profile, universe);
      const cfg = RISK_CONFIG[profile.riskTolerance];
      const turnoverCapUsd = navUsd * cfg.maxDailyTurnoverPct;

      const currentBySymbol = new Map(holdings.filter(h => h.symbol !== 'USD').map(h => [h.symbol, h.units * (prices.get(h.symbol) ?? h.avgCostUsd)]));
      const allSymbols = new Set([...targetWeights.keys(), ...currentBySymbol.keys()]);

      // Buy-only: this daily pass deploys idle cash toward target (a fresh deposit becomes a
      // basket), it never sells an existing position to correct drift from a price move — that's
      // exactly the "auto-rebalancing" the 2026-09-21 pivot removed. Trimming an overweight
      // position now only ever happens through an explicitly accepted suggestion
      // (nest-suggestions.service.ts, NestRebalanceService.executeSingleTrade) — never silently.
      let cashUsd = holdings.find(h => h.symbol === 'USD')?.units ?? 0;
      const userDeltas: Array<{ symbol: string; deltaUsd: number }> = [];
      for (const symbol of allSymbols) {
        if (!prices.has(symbol)) continue;
        const deltaUsd = (targetWeights.get(symbol) ?? 0) * navUsd - (currentBySymbol.get(symbol) ?? 0);
        if (deltaUsd >= MIN_USER_TRADE_USD) userDeltas.push({ symbol, deltaUsd });
      }
      userDeltas.sort((a, b) => a.deltaUsd - b.deltaUsd);

      let remainingTurnover = turnoverCapUsd;
      for (const { symbol, deltaUsd: rawDelta } of userDeltas) {
        let cappedAbs = Math.min(Math.abs(rawDelta), Math.max(remainingTurnover, 0));
        if (rawDelta > 0) cappedAbs = Math.min(cappedAbs, Math.max(cashUsd, 0));
        if (cappedAbs < MIN_USER_TRADE_USD) continue;
        const deltaUsd = Math.sign(rawDelta) * cappedAbs;
        remainingTurnover -= cappedAbs;
        cashUsd -= deltaUsd;

        if (!userDeltasBySymbol.has(symbol)) userDeltasBySymbol.set(symbol, []);
        userDeltasBySymbol.get(symbol)!.push({ userId: profile.userId, deltaUsd });
        netDeltaUsdBySymbol.set(symbol, (netDeltaUsdBySymbol.get(symbol) ?? 0) + deltaUsd);
      }
    }

    const maxPerSymbolPerDay = this.maxTradeUsdPerSymbolPerDay();
    const symbolBySymbolStr = new Map(universe.map(a => [a.symbol, a]));
    const nowIso = new Date().toISOString();
    const affectedUsers = new Set<string>();

    for (const [symbol, netUsdRaw] of netDeltaUsdBySymbol) {
      if (Math.abs(netUsdRaw) < MIN_NET_TRADE_USD) continue;
      const netUsd = Math.sign(netUsdRaw) * Math.min(Math.abs(netUsdRaw), maxPerSymbolPerDay);
      const asset = symbolBySymbolStr.get(symbol);
      const price = prices.get(symbol);
      if (!asset || !price) continue;

      let fillPrice = price;
      let txSignature: string | null = null;
      if (liveTrading) {
        try {
          if (netUsd > 0) {
            const { outAmountAtomic } = await this.executeTreasurySwap(USDC_MINT, asset.solanaMint, BigInt(Math.round(netUsd * 1_000_000)));
            const outUnits = Number(outAmountAtomic) / 10 ** asset.decimals;
            fillPrice = outUnits > 0 ? netUsd / outUnits : price;
            txSignature = 'pending'; // overwritten below once we capture the real signature
          } else {
            const unitsToSell = Math.abs(netUsd) / price;
            await this.executeTreasurySwap(asset.solanaMint, USDC_MINT, BigInt(Math.round(unitsToSell * 10 ** asset.decimals)));
          }
        } catch (e: any) {
          this.logger.error(`executeTreasurySwap(${symbol}, net=$${netUsd.toFixed(2)}) failed: ${e.message} — skipping this symbol this cycle`);
          continue;
        }
      }

      // Fan the net fill back out to each contributing user, proportional to their own delta —
      // scaled down if the aggregate got capped by maxPerSymbolPerDay above.
      const scale = netUsdRaw !== 0 ? netUsd / netUsdRaw : 0;
      for (const { userId, deltaUsd } of userDeltasBySymbol.get(symbol) ?? []) {
        const userDeltaUsd = deltaUsd * scale;
        if (Math.abs(userDeltaUsd) < MIN_USER_TRADE_USD) continue;
        const unitsDelta = userDeltaUsd / fillPrice;
        await this.applyFillToUser(userId, symbol, unitsDelta, fillPrice, userDeltaUsd, txSignature, liveTrading);
        affectedUsers.add(userId);
      }
    }

    // Devnet-demo users: same target-weight math, but always simulated at current price,
    // independently per user — never netted with real users, never triggers a real trade
    // regardless of the global liveTrading flag.
    for (const profile of demoProfiles) {
      const holdings = holdingsByUser.get(profile.userId) ?? [];
      await this.processDemoProfile(profile, holdings, universe, prices);
      affectedUsers.add(profile.userId);
    }

    await this.writeNavSnapshots(profiles.map(p => p.userId), universe, prices, nowIso.slice(0, 10));
  }

  private async processDemoProfile(
    profile: UserProfile,
    holdings: HoldingRow[],
    universe: NestUniverseAsset[],
    prices: Map<string, number>,
  ): Promise<void> {
    const navUsd = holdings.reduce((sum, h) => sum + h.units * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? h.avgCostUsd), 0);
    if (navUsd <= 0) return;

    const targetWeights = this.computeTargetWeights(profile, universe);
    const currentBySymbol = new Map(holdings.filter(h => h.symbol !== 'USD').map(h => [h.symbol, h.units * (prices.get(h.symbol) ?? h.avgCostUsd)]));
    const allSymbols = new Set([...targetWeights.keys(), ...currentBySymbol.keys()]);

    // Buy-only, same as the real-user path above: this daily pass deploys idle cash toward
    // target (a fresh deposit becomes a basket), it never sells an existing position to correct
    // drift — that's the "auto-rebalancing" the 2026-09-21 pivot removed. Trimming an overweight
    // demo position only happens through an accepted suggestion. maxDailyTurnoverPct (a
    // real-money safety brake) is skipped for demo profiles since no real capital is at risk —
    // the full buy list fills in one pass. Symbols with no live quote still count in NAV (at
    // cost) but are never traded this pass.
    let cashUsd = holdings.find(h => h.symbol === 'USD')?.units ?? 0;
    const deltas: Array<{ symbol: string; deltaUsd: number; price: number }> = [];
    for (const symbol of allSymbols) {
      const price = prices.get(symbol);
      if (!price) continue;
      const deltaUsd = (targetWeights.get(symbol) ?? 0) * navUsd - (currentBySymbol.get(symbol) ?? 0);
      if (deltaUsd >= MIN_USER_TRADE_USD) deltas.push({ symbol, deltaUsd, price });
    }
    deltas.sort((a, b) => a.deltaUsd - b.deltaUsd);

    // Cash repair: if a previous pass left cash overdrawn, sell down the largest priced positions
    // until it's back to zero before allocating anything new.
    if (cashUsd < 0) {
      const sellable = [...currentBySymbol.entries()]
        .filter(([sym, usd]) => usd > 0 && prices.has(sym))
        .sort((a, b) => b[1] - a[1]);
      for (const [symbol, currentUsd] of sellable) {
        if (cashUsd >= 0) break;
        const sellUsd = Math.min(currentUsd, -cashUsd);
        if (sellUsd < MIN_USER_TRADE_USD) continue;
        const price = prices.get(symbol)!;
        await this.applyFillToUser(profile.userId, symbol, -sellUsd / price, price, -sellUsd, null, false);
        currentBySymbol.set(symbol, currentUsd - sellUsd);
        cashUsd += sellUsd;
        const d = deltas.find(x => x.symbol === symbol);
        if (d) d.deltaUsd += sellUsd;
      }
    }

    for (const { symbol, deltaUsd, price } of deltas) {
      let tradeUsd = deltaUsd;
      if (tradeUsd > 0) tradeUsd = Math.min(tradeUsd, Math.max(cashUsd, 0));
      if (Math.abs(tradeUsd) < MIN_USER_TRADE_USD) continue;
      cashUsd -= tradeUsd;
      await this.applyFillToUser(profile.userId, symbol, tradeUsd / price, price, tradeUsd, null, false);
    }
  }

  /**
   * Manual, single-user trigger for the devnet-demo path only — the real daily cron
   * (nest-cron.service.ts) is disabled outside production and only fires once a day, so without
   * this there's no way to see a fresh deposit actually turn into a basket while testing. Scoped
   * tightly on purpose: only ever touches the caller's own demo ledger (never real profiles,
   * never live trading, never other users) — safe to expose to any authenticated caller.
   */
  async runDemoRebalanceForUser(demoLedgerUserId: string): Promise<{ ran: boolean }> {
    const db = this.supabase.getClient();
    const universe = await this.xstocks.getUniverse();
    if (universe.length === 0) throw new Error('Nest universe is empty (Backed API unreachable?) — try again shortly');

    const { data: profileRow, error: profileErr } = await db
      .from('nest_profiles')
      .select('user_id, risk_tolerance, interest_tags')
      .eq('user_id', demoLedgerUserId)
      .maybeSingle();
    if (profileErr) throw new Error(`load profile: ${profileErr.message}`);
    if (!profileRow) return { ran: false };

    const prices = await this.xstocks.getPrices(universe.map(a => a.symbol));

    const { data: holdingRows, error: holdingsErr } = await db
      .from('nest_holdings')
      .select('symbol, units, avg_cost_usd')
      .eq('user_id', demoLedgerUserId);
    if (holdingsErr) throw new Error(`load holdings: ${holdingsErr.message}`);
    const holdings: HoldingRow[] = (holdingRows ?? []).map(r => ({ userId: demoLedgerUserId, symbol: r.symbol, units: Number(r.units), avgCostUsd: Number(r.avg_cost_usd) }));

    const profile: UserProfile = { userId: demoLedgerUserId, riskTolerance: profileRow.risk_tolerance, interestTags: profileRow.interest_tags ?? [] };
    await this.processDemoProfile(profile, holdings, universe, prices);
    await this.writeNavSnapshots([demoLedgerUserId], universe, prices, new Date().toISOString().slice(0, 10));
    return { ran: true };
  }

  /**
   * Execute exactly one accepted suggestion (nest-suggestions.service.ts) — a single user, single
   * symbol, user-approved trade. Mirrors doRun's real-trade branch (treasury swap for a real user
   * when live, simulated fill otherwise) but scoped to one action instead of the daily netted
   * batch, since this only ever fires from an explicit user click, never a cron.
   */
  async executeSingleTrade(ledgerUserId: string, symbol: string, deltaUsd: number): Promise<void> {
    if (Math.abs(deltaUsd) < MIN_USER_TRADE_USD) throw new Error(`Trade too small ($${deltaUsd.toFixed(2)}) — already at target`);
    const universe = await this.xstocks.getUniverse();
    const asset = universe.find(a => a.symbol === symbol);
    if (!asset) throw new Error(`Unknown symbol ${symbol}`);
    const prices = await this.xstocks.getPrices([symbol]);
    const price = prices.get(symbol);
    if (!price) throw new Error(`No live price for ${symbol} — try again shortly`);

    const isDemo = isDemoLedgerUserId(ledgerUserId);
    const liveTrading = !isDemo && this.isLiveTrading();
    let fillPrice = price;
    let txSignature: string | null = null;
    if (liveTrading) {
      if (deltaUsd > 0) {
        const { outAmountAtomic } = await this.executeTreasurySwap(USDC_MINT, asset.solanaMint, BigInt(Math.round(deltaUsd * 1_000_000)));
        const outUnits = Number(outAmountAtomic) / 10 ** asset.decimals;
        fillPrice = outUnits > 0 ? deltaUsd / outUnits : price;
        txSignature = 'pending';
      } else {
        const unitsToSell = Math.abs(deltaUsd) / price;
        await this.executeTreasurySwap(asset.solanaMint, USDC_MINT, BigInt(Math.round(unitsToSell * 10 ** asset.decimals)));
      }
    }
    await this.applyFillToUser(ledgerUserId, symbol, deltaUsd / fillPrice, fillPrice, deltaUsd, txSignature, liveTrading, 'You accepted a suggestion');
    // Snapshot NAV against prices for the user's WHOLE basket, not just the one symbol traded.
    // `prices` above holds a single quote, and writeNavSnapshots values anything missing from the
    // map at cost — so reusing it here would stamp a snapshot where every other position is
    // frozen at its purchase price, quietly corrupting the performance chart on every accepted
    // suggestion.
    const { data: rows } = await this.supabase.getClient().from('nest_holdings').select('symbol').eq('user_id', ledgerUserId).neq('symbol', 'USD');
    const navPrices = await this.xstocks.getPrices([...new Set((rows ?? []).map(r => r.symbol))]);
    await this.writeNavSnapshots([ledgerUserId], universe, navPrices, new Date().toISOString().slice(0, 10));
  }

  private async applyFillToUser(
    userId: string,
    symbol: string,
    unitsDelta: number,
    fillPrice: number,
    usdValue: number,
    txSignature: string | null,
    liveTrading: boolean,
    whyOverride?: string,
  ): Promise<void> {
    const db = this.supabase.getClient();
    const side: 'buy' | 'sell' = unitsDelta >= 0 ? 'buy' : 'sell';

    const [{ data: existingSymbolRow }, { data: cashRow }] = await Promise.all([
      db.from('nest_holdings').select('units, avg_cost_usd').eq('user_id', userId).eq('symbol', symbol).maybeSingle(),
      db.from('nest_holdings').select('units').eq('user_id', userId).eq('symbol', 'USD').maybeSingle(),
    ]);

    const prevUnits = existingSymbolRow ? Number(existingSymbolRow.units) : 0;
    const prevAvgCost = existingSymbolRow ? Number(existingSymbolRow.avg_cost_usd) : 0;
    const newUnits = prevUnits + unitsDelta;
    const newAvgCost = side === 'buy' && newUnits > 0 ? (prevUnits * prevAvgCost + Math.abs(unitsDelta) * fillPrice) / newUnits : prevAvgCost;

    const cashUnits = cashRow ? Number(cashRow.units) : 0;
    const newCashUnits = cashUnits - usdValue; // buy consumes cash, sell replenishes it (usdValue is signed)

    // Equal-weight allocator (see computeTargetWeights) — the trade happened because this
    // symbol's weight drifted from target (price move, deposit, or a tag/risk-profile change),
    // never because of an attention/sentiment score. Say that plainly rather than implying a
    // signal-driven "why" that no longer exists.
    const amount = `$${Math.abs(usdValue).toFixed(2)}`;
    const verb = side === 'buy' ? 'Added' : 'Trimmed';
    const why = whyOverride ?? (prevUnits === 0 && side === 'buy' ? 'starting position' : 'rebalancing to target mix');
    const reason = `${liveTrading ? '' : '[SIMULATED] '}${verb} ${amount} — ${why}`;

    await db.from('nest_holdings').upsert({ user_id: userId, symbol, units: newUnits, avg_cost_usd: newAvgCost, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' });
    await db.from('nest_holdings').upsert({ user_id: userId, symbol: 'USD', units: newCashUnits, avg_cost_usd: 1, updated_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' });
    await db.from('nest_trades').insert({
      user_id: userId,
      symbol,
      side,
      units: Math.abs(unitsDelta),
      price_usd: fillPrice,
      usd_value: Math.abs(usdValue),
      reason,
      tx_signature: txSignature === 'pending' ? null : txSignature,
    });
  }

  private async writeNavSnapshots(userIds: string[], universe: NestUniverseAsset[], prices: Map<string, number>, date: string): Promise<void> {
    const db = this.supabase.getClient();
    const uniqueUserIds = [...new Set(userIds)];
    const { data: holdingRows } = await db.from('nest_holdings').select('user_id, symbol, units, avg_cost_usd').in('user_id', uniqueUserIds);
    const byUser = new Map<string, HoldingRow[]>();
    for (const r of holdingRows ?? []) {
      const row: HoldingRow = { userId: r.user_id, symbol: r.symbol, units: Number(r.units), avgCostUsd: Number(r.avg_cost_usd) };
      if (!byUser.has(row.userId)) byUser.set(row.userId, []);
      byUser.get(row.userId)!.push(row);
    }
    const snapshots = uniqueUserIds.map(userId => {
      const holdings = byUser.get(userId) ?? [];
      const totalValueUsd = holdings.reduce((sum, h) => sum + h.units * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? h.avgCostUsd), 0);
      const totalCostUsd = holdings.reduce((sum, h) => sum + h.units * h.avgCostUsd, 0);
      return { user_id: userId, snapshot_date: date, total_value_usd: totalValueUsd, total_cost_usd: totalCostUsd };
    });
    if (snapshots.length === 0) return;
    const { error } = await db.from('nest_nav_snapshots').upsert(snapshots, { onConflict: 'user_id,snapshot_date' });
    if (error) this.logger.error(`writeNavSnapshots: ${error.message}`);
  }
}
