import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { SupabaseService } from '@/database/supabase.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { XStocksService, NestUniverseAsset } from './xstocks.service';
import { ElfaService } from './elfa.service';
import { NestRiskTolerance } from './nest.service';
import { isDemoLedgerUserId } from './nest-ledger-id';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPITER_API_BASE = 'https://api.jup.ag/swap/v2';

interface RiskConfig {
  maxPositions: number;
  maxWeightPerPosition: number;
  maxDailyTurnoverPct: number; // fraction of a user's own NAV that can move in one rebalance tick
  cashFloorPct: number; // fraction always left as uninvested "USD" cash
}

const RISK_CONFIG: Record<NestRiskTolerance, RiskConfig> = {
  conservative: { maxPositions: 8, maxWeightPerPosition: 0.15, maxDailyTurnoverPct: 0.05, cashFloorPct: 0.1 },
  balanced: { maxPositions: 15, maxWeightPerPosition: 0.2, maxDailyTurnoverPct: 0.1, cashFloorPct: 0.05 },
  aggressive: { maxPositions: 25, maxWeightPerPosition: 0.3, maxDailyTurnoverPct: 0.2, cashFloorPct: 0 },
};

// How strongly a positive elfa signal tilts weight above the equal-weight baseline. 0 would make
// this a pure interest-tag index fund; 1 would let sentiment dominate position sizing entirely.
const SENTIMENT_TILT_STRENGTH = 0.6;

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
    private readonly elfa: ElfaService,
  ) {}

  private isLiveTrading(): boolean {
    return this.config.get<string>('NEST_LIVE_TRADING') === 'true';
  }

  private maxTradeUsdPerSymbolPerDay(): number {
    const raw = Number(this.config.get<string>('NEST_MAX_TRADE_USD_PER_SYMBOL_PER_DAY'));
    return Number.isFinite(raw) && raw > 0 ? raw : 500;
  }

  /** Target weight per symbol for one profile, given the shared sentiment cache. Filters the
   *  universe to the profile's interest tags (untagged profile = whole universe), ranks by
   *  sentiment, keeps the top N for this risk tier, tilts weight by sentiment, caps any single
   *  position, and reserves a risk-tier cash floor. Deterministic and side-effect free so it can
   *  be unit tested and reused for the onboarding "preview my basket" endpoint later. */
  computeTargetWeights(profile: UserProfile, universe: NestUniverseAsset[], sentiment: Map<string, { score: number }>): Map<string, number> {
    const cfg = RISK_CONFIG[profile.riskTolerance];
    const candidates = profile.interestTags.length > 0 ? universe.filter(a => a.tags.some(t => profile.interestTags.includes(t))) : universe;
    if (candidates.length === 0) return new Map();

    const scored = candidates
      .map(a => ({ symbol: a.symbol, score: sentiment.get(a.symbol)?.score ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.maxPositions);

    const raw = scored.map(s => ({ symbol: s.symbol, w: 1 + Math.max(s.score, 0) * SENTIMENT_TILT_STRENGTH }));
    const rawSum = raw.reduce((sum, r) => sum + r.w, 0);
    const investableFraction = 1 - cfg.cashFloorPct;

    const weights = new Map<string, number>();
    for (const r of raw) {
      weights.set(r.symbol, Math.min((r.w / rawSum) * investableFraction, cfg.maxWeightPerPosition));
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
   * Daily rebalance: refresh sentiment, compute each opted-in user's target basket, net every
   * user's delta for the same symbol into one treasury-level trade (minimizes swap count/fees vs.
   * trading per-user), execute (or simulate) it, then fan the fill back out into each user's own
   * ledger proportional to their share of that symbol's net delta.
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

    await this.elfa.refreshCache(universe);
    const sentiment = await this.elfa.getCachedScores(universe.map(a => a.symbol));
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

      const targetWeights = this.computeTargetWeights(profile, universe, sentiment);
      const cfg = RISK_CONFIG[profile.riskTolerance];
      const turnoverCapUsd = navUsd * cfg.maxDailyTurnoverPct;

      const currentBySymbol = new Map(holdings.filter(h => h.symbol !== 'USD').map(h => [h.symbol, h.units * (prices.get(h.symbol) ?? h.avgCostUsd)]));
      const allSymbols = new Set([...targetWeights.keys(), ...currentBySymbol.keys()]);

      let remainingTurnover = turnoverCapUsd;
      for (const symbol of allSymbols) {
        const targetUsd = (targetWeights.get(symbol) ?? 0) * navUsd;
        const currentUsd = currentBySymbol.get(symbol) ?? 0;
        let deltaUsd = targetUsd - currentUsd;
        if (Math.abs(deltaUsd) < MIN_USER_TRADE_USD) continue;
        const cappedAbs = Math.min(Math.abs(deltaUsd), Math.max(remainingTurnover, 0));
        if (cappedAbs < MIN_USER_TRADE_USD) continue;
        deltaUsd = Math.sign(deltaUsd) * cappedAbs;
        remainingTurnover -= cappedAbs;

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
        await this.applyFillToUser(userId, symbol, unitsDelta, fillPrice, userDeltaUsd, sentiment.get(symbol)?.score ?? 0, txSignature, liveTrading);
        affectedUsers.add(userId);
      }
    }

    // Devnet-demo users: same target-weight math, but always simulated at current price,
    // independently per user — never netted with real users, never triggers a real trade
    // regardless of the global liveTrading flag.
    for (const profile of demoProfiles) {
      const holdings = holdingsByUser.get(profile.userId) ?? [];
      const navUsd = holdings.reduce((sum, h) => sum + h.units * (h.symbol === 'USD' ? 1 : prices.get(h.symbol) ?? h.avgCostUsd), 0);
      if (navUsd <= 0) continue;

      const targetWeights = this.computeTargetWeights(profile, universe, sentiment);
      const cfg = RISK_CONFIG[profile.riskTolerance];
      const currentBySymbol = new Map(holdings.filter(h => h.symbol !== 'USD').map(h => [h.symbol, h.units * (prices.get(h.symbol) ?? h.avgCostUsd)]));
      const allSymbols = new Set([...targetWeights.keys(), ...currentBySymbol.keys()]);

      let remainingTurnover = navUsd * cfg.maxDailyTurnoverPct;
      for (const symbol of allSymbols) {
        const price = prices.get(symbol);
        if (!price) continue;
        const targetUsd = (targetWeights.get(symbol) ?? 0) * navUsd;
        const currentUsd = currentBySymbol.get(symbol) ?? 0;
        let deltaUsd = targetUsd - currentUsd;
        if (Math.abs(deltaUsd) < MIN_USER_TRADE_USD) continue;
        const cappedAbs = Math.min(Math.abs(deltaUsd), Math.max(remainingTurnover, 0));
        if (cappedAbs < MIN_USER_TRADE_USD) continue;
        deltaUsd = Math.sign(deltaUsd) * cappedAbs;
        remainingTurnover -= cappedAbs;

        const unitsDelta = deltaUsd / price;
        await this.applyFillToUser(profile.userId, symbol, unitsDelta, price, deltaUsd, sentiment.get(symbol)?.score ?? 0, null, false);
        affectedUsers.add(profile.userId);
      }
    }

    await this.writeNavSnapshots(profiles.map(p => p.userId), universe, prices, nowIso.slice(0, 10));
  }

  private async applyFillToUser(
    userId: string,
    symbol: string,
    unitsDelta: number,
    fillPrice: number,
    usdValue: number,
    sentimentScore: number,
    txSignature: string | null,
    liveTrading: boolean,
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

    const reason = `${liveTrading ? '' : '[SIMULATED] '}rebalance: elfa score ${sentimentScore.toFixed(2)}, ${side} $${Math.abs(usdValue).toFixed(2)}`;

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
