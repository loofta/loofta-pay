import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PredictionMarketsService } from './prediction-markets.service';

// Practice stakes. A default of $1 keeps the first tap a one-click decision; the range exists so
// someone can size up a view they feel strongly about without this becoming a money sink.
export const DEFAULT_STAKE_USD = 1;
const MIN_STAKE_USD = 1;
const MAX_STAKE_USD = 100;
// Below/above these the payout maths stop being meaningful (a 1% market pays 100x, a 99% one pays
// nothing) and the card reads like a bug.
const MIN_PRICE = 0.02;
const MAX_PRICE = 0.98;

export interface NestPredictionBet {
  id: string;
  marketId: string;
  venue: string;
  symbol: string | null;
  question: string;
  side: 'yes' | 'no';
  stakeUsd: number;
  /** Price of the chosen side when the bet was placed, 0-1. */
  price: number;
  /** What this pays out if the side wins — stake included, not profit on top. */
  payoutUsd: number;
  status: 'active' | 'won' | 'lost' | 'void';
  closesAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Practice bets on real prediction markets.
 *
 * The questions and odds are real and live (Kalshi, via PredictionMarketsService); the bet is
 * simulated. Nothing is placed on any exchange and no money moves — this table is the whole
 * record. It deliberately never touches nest_holdings: a stake is not a position, and folding it
 * into the investing ledger would corrupt NAV and hand the equal-weight allocator cash that
 * doesn't exist.
 *
 * Payout is the standard binary-contract maths: one contract costs `price` and pays $1 if it
 * resolves your way, so a stake buys `stake / price` contracts and returns `stake / price` —
 * stake included. Betting $1 on a 52¢ Yes returns $1.92 if Yes happens, $0 if it doesn't.
 */
@Injectable()
export class PredictionBetsService {
  private readonly logger = new Logger(PredictionBetsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly markets: PredictionMarketsService,
  ) {}

  /** Stake and price in, payout out. Kept in one place so the card, the bet and any future
   *  settlement all agree on the number. */
  static payoutFor(stakeUsd: number, price: number): number {
    return Math.round((stakeUsd / price) * 100) / 100;
  }

  /**
   * Place (or add to) a practice bet. Prices come from the live market rather than the client, so
   * a stale card or a tampered request can't lock in odds that were never offered.
   *
   * Betting the same side of the same market again tops up the open position at a blended price
   * rather than opening a second row — two positions on one outcome is just one position, and
   * settling them separately would be a reconciliation problem with no upside.
   */
  async place(ledgerUserId: string, marketId: string, side: 'yes' | 'no', stakeUsd: number, symbolHint?: string | null): Promise<NestPredictionBet> {
    if (!Number.isFinite(stakeUsd) || stakeUsd < MIN_STAKE_USD || stakeUsd > MAX_STAKE_USD) {
      throw new BadRequestException(`Stake must be between $${MIN_STAKE_USD} and $${MAX_STAKE_USD}`);
    }

    const market = await this.markets.findById(marketId, symbolHint);
    if (!market) throw new NotFoundException('That market is no longer available');
    if (market.yesPrice === null) throw new BadRequestException('That market has no price right now — try again shortly');

    const price = side === 'yes' ? market.yesPrice : 1 - market.yesPrice;
    if (price < MIN_PRICE || price > MAX_PRICE) {
      throw new BadRequestException('That side is priced too close to certain to bet on right now');
    }

    const db = this.supabase.getClient();
    const { data: existing } = await db
      .from('nest_prediction_bets')
      .select('id, stake_usd, price')
      .eq('user_id', ledgerUserId)
      .eq('market_id', marketId)
      .eq('side', side)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      const addedStake = stakeUsd;
      const totalStake = Number(existing.stake_usd) + addedStake;
      if (totalStake > MAX_STAKE_USD) throw new BadRequestException(`That would take this bet over the $${MAX_STAKE_USD} limit`);
      // Blended price: what the whole stake effectively paid, so the payout stays honest about
      // the odds each part was taken at.
      const totalPayout = Number(existing.stake_usd) / Number(existing.price) + addedStake / price;
      const blendedPrice = totalStake / totalPayout;
      const { data, error } = await db
        .from('nest_prediction_bets')
        .update({
          stake_usd: Math.round(totalStake * 100) / 100,
          price: Math.round(blendedPrice * 10000) / 10000,
          payout_usd: Math.round(totalPayout * 100) / 100,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw new Error(`top up bet: ${error.message}`);
      return this.toView(data);
    }

    const { data, error } = await db
      .from('nest_prediction_bets')
      .insert({
        user_id: ledgerUserId,
        market_id: marketId,
        venue: market.venue,
        symbol: market.symbol,
        question: market.question,
        side,
        stake_usd: stakeUsd,
        price: Math.round(price * 10000) / 10000,
        payout_usd: PredictionBetsService.payoutFor(stakeUsd, price),
        closes_at: market.closeTime,
      })
      .select('*')
      .single();
    if (error) throw new Error(`place bet: ${error.message}`);
    return this.toView(data);
  }

  async listForUser(ledgerUserId: string): Promise<NestPredictionBet[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('nest_prediction_bets')
      .select('*')
      .eq('user_id', ledgerUserId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listForUser: ${error.message}`);
    return (data ?? []).map(r => this.toView(r));
  }

  /** Close an open position before its market settles — a practice bet should be walkable-away
   *  from, and leaving it to sit until 2027 makes the list unusable. */
  async cancel(ledgerUserId: string, id: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('nest_prediction_bets')
      .update({ status: 'void', resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', ledgerUserId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new Error(`cancel: ${error.message}`);
    if (!data?.length) throw new NotFoundException('That bet is no longer open');
  }

  private toView(r: any): NestPredictionBet {
    return {
      id: r.id,
      marketId: r.market_id,
      venue: r.venue,
      symbol: r.symbol,
      question: r.question,
      side: r.side,
      stakeUsd: Number(r.stake_usd),
      price: Number(r.price),
      payoutUsd: Number(r.payout_usd),
      status: r.status,
      closesAt: r.closes_at,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    };
  }
}
