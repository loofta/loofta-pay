import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { LotteryService } from './lottery.service';
import { UsersService } from '../users/users.service';

// Same mainnet USDC mint used everywhere else in this module (lottery.service.ts) — this app's
// money flows run against mainnet USDC regardless of cluster setting, so this is intentionally
// not conditional on devnet/mainnet config.
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export type PackRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export interface PackTierConfig {
  tierKey: string;
  ticketsAwarded: number;
  weight: number;
  rarity: PackRarity;
  enabled: boolean;
  displayOrder: number;
}

export interface PackTierPublic {
  tierKey: string;
  ticketsAwarded: number;
  rarity: PackRarity;
  displayOrder: number;
}

export interface PackOpenResult {
  id: string;
  tierKey: string;
  ticketsAwarded: number;
  rarity: PackRarity;
}

// Every pack costs exactly this much USDC, paid up front as a plain on-chain transfer to the
// treasury wallet (see getTreasuryAddress) and verified before any roll happens. Ticket-purchase
// automation on top of that charge is a separate, not-yet-built phase (see
// pack_openings.lottery_ticket_id).
const PACK_PRICE_USDC = 2;

// Converts decimal probabilities (e.g. 1/3200 = 0.0003125) into an integer weight range for
// crypto.randomInt. 1e8 keeps the rounding error many orders of magnitude below the smallest
// published odds, so it never perceptibly shifts a payout.
const WEIGHT_SCALE = 100_000_000;

// Caps + window for retrying a pack's real ticket purchase after a treasury-funding failure
// (mirrors MAX_AUTO_RETRIES/AUTO_RETRY_MAX_AGE_MS in lottery.service.ts for the equivalent
// failed-lottery_ticket retry). A pack win is already recorded by the time this ever runs, so
// this only ever affects when/whether the actual Megapot ticket gets bought — never the prize.
const MAX_PACK_PURCHASE_RETRIES = 3;
const PACK_PURCHASE_RETRY_MAX_AGE_MS = 48 * 60 * 60_000;

// The treasury funds every pack win's real ticket purchase (see LotteryService.
// purchaseTicketsForUser) on top of sponsoring pack-payment gas/ATA rent. $10 covers the largest
// payout any CURRENTLY ENABLED tier can hit (10 tickets @ $1) — if the treasury can't cover that,
// packs are paused before anyone pays, rather than risking a paid-for pack whose ticket purchase
// can't be funded at all (50/100-ticket tiers are disabled today; raise this if they're enabled).
const MIN_TREASURY_BALANCE_USDC = 10;

// How far back findRecoverablePayment looks for a stray, unconsumed payment — matches the
// frontend's own localStorage TTL for the same recovery concept (packs/page.tsx
// PACK_PAYMENT_TTL_MS), so "recoverable on refresh" and "recoverable server-side" agree.
const RECOVERABLE_PAYMENT_WINDOW_MS = 60 * 60 * 1000;

// Hardcoded exception: this one Privy user can use demo (no-payment, no-real-ticket) pack opens
// even in production — everyone else still gets the hard production block.
const DEMO_MODE_ALLOWED_USER_ID = 'did:privy:cmmqqbaad00au0dkwumsmkget';

@Injectable()
export class PackService {
  private readonly logger = new Logger(PackService.name);

  // Tier config changes only via an admin toggle, so a short cache avoids a DB round trip on
  // every "open pack" click without risking meaningfully stale odds.
  private tiersCache: { tiers: PackTierConfig[]; loadedAt: number } | null = null;
  private readonly TIERS_CACHE_MS = 10_000;

  // Same reasoning as tiersCache — the daily limit only ever changes via an admin edit.
  private settingsCache: { dailyOpenLimit: number | null; loadedAt: number } | null = null;
  private readonly SETTINGS_CACHE_MS = 10_000;

  // Overlap guard for retryFailedPackPurchases, same pattern as LotteryService's cron methods.
  private processingPackPurchaseRetry = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly lottery: LotteryService,
    private readonly usersService: UsersService,
  ) {}

  private async getSolanaConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    return new Connection(rpc, 'confirmed');
  }

  /**
   * Reuses the same fee wallet already configured for lottery-ticket fee collection
   * (SOLANA_FEE_PAYER_PRIVATE_KEY, KMS-wrapped in prod) as the pack-payment treasury — same
   * custody/operational model, no new secret to provision. Only the public key is ever used
   * here; PackService never signs anything with it.
   */
  private async getTreasuryAddress(): Promise<string> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    return Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey)).publicKey.toBase58();
  }

  /** Raw USDC units currently sitting in the treasury's own token account — 0n if the account
   *  doesn't exist yet or the RPC call fails, so a transient hiccup reads as "can't confirm
   *  funded" rather than throwing and taking the whole config/payment endpoint down with it.
   *  Cached briefly (same pattern as loadTiers' tiersCache) since GET /packs/config hits this on
   *  every single page load — without caching, that's a real Solana RPC round trip in the
   *  critical path of the page just loading, every time. `fresh: true` bypasses the cache for
   *  the admin treasury-status view, where a stale reading isn't acceptable. */
  private treasuryBalanceCache: { units: bigint; loadedAt: number } | null = null;
  private readonly TREASURY_BALANCE_CACHE_MS = 20_000;
  private async getTreasuryUsdcBalanceUnits(opts?: { fresh?: boolean }): Promise<bigint> {
    if (!opts?.fresh && this.treasuryBalanceCache && Date.now() - this.treasuryBalanceCache.loadedAt < this.TREASURY_BALANCE_CACHE_MS) {
      return this.treasuryBalanceCache.units;
    }
    const treasury = await this.getTreasuryAddress();
    const conn = await this.getSolanaConnection();
    const ata = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(treasury));
    let units: bigint;
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      units = BigInt(bal.value.amount);
    } catch {
      units = 0n;
    }
    this.treasuryBalanceCache = { units, loadedAt: Date.now() };
    return units;
  }

  /** Whether the treasury can currently cover the largest payout an enabled tier could hit —
   *  gates buildPaymentTx (see below) so a pack is never sold that we can't actually fund the
   *  win for. Uses the cached balance — a payment 0-20s de-synced with the real balance is an
   *  acceptable trade-off for not hitting Solana RPC on every page load; the actual treasury-
   *  funded ticket purchase already has its own independent retry-on-failure path regardless. */
  async isTreasuryFunded(): Promise<boolean> {
    const units = await this.getTreasuryUsdcBalanceUnits();
    return units >= BigInt(Math.round(MIN_TREASURY_BALANCE_USDC * 1_000_000));
  }

  /** Admin-only view of the actual treasury balance/threshold — never exposed on the public
   *  config endpoint (that only ever returns the boolean `available`), since the real balance is
   *  operational/financial detail. Always reads fresh (not the cached value) since an admin
   *  deciding whether to add funds needs the real current number, not a 0-20s-old one. */
  async getTreasuryStatus(): Promise<{ balanceUsdc: number; minRequiredUsdc: number; sufficient: boolean; treasuryAddress: string }> {
    const [units, treasuryAddress] = await Promise.all([this.getTreasuryUsdcBalanceUnits({ fresh: true }), this.getTreasuryAddress()]);
    const balanceUsdc = Number(units) / 1_000_000;
    return { balanceUsdc, minRequiredUsdc: MIN_TREASURY_BALANCE_USDC, sufficient: balanceUsdc >= MIN_TREASURY_BALANCE_USDC, treasuryAddress };
  }

  private async loadSettings(): Promise<{ dailyOpenLimit: number | null }> {
    if (this.settingsCache && Date.now() - this.settingsCache.loadedAt < this.SETTINGS_CACHE_MS) {
      return { dailyOpenLimit: this.settingsCache.dailyOpenLimit };
    }
    const db = this.supabase.getClient();
    const { data, error } = await db.from('pack_settings').select('daily_open_limit').eq('id', true).maybeSingle();
    if (error) throw new Error(`Failed to load pack settings: ${error.message}`);
    const dailyOpenLimit = data?.daily_open_limit ?? null;
    this.settingsCache = { dailyOpenLimit, loadedAt: Date.now() };
    return { dailyOpenLimit };
  }

  /** Admin: current daily-open-limit-per-user setting (null = unlimited). */
  async getDailyOpenLimit(): Promise<number | null> {
    return (await this.loadSettings()).dailyOpenLimit;
  }

  /** Admin: set (or clear, with null) the daily-open-limit-per-user. */
  async setDailyOpenLimit(limit: number | null): Promise<{ dailyOpenLimit: number | null }> {
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      throw new BadRequestException('dailyOpenLimit must be a positive integer or null');
    }
    const db = this.supabase.getClient();
    const { error } = await db.from('pack_settings').update({ daily_open_limit: limit, updated_at: new Date().toISOString() }).eq('id', true);
    if (error) throw new Error(`Failed to update pack settings: ${error.message}`);
    this.settingsCache = null;
    return { dailyOpenLimit: limit };
  }

  /** Real (non-demo) packs this user has opened since the start of the current UTC day — demo
   *  opens (is_test=true) never count, so testers/admins previewing the flow never eat into
   *  their own or anyone else's real daily allowance. */
  private async getOpensToday(userId: string): Promise<number> {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const db = this.supabase.getClient();
    const { count, error } = await db
      .from('pack_openings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_test', false)
      .gte('created_at', startOfDayUtc.toISOString());
    if (error) throw new Error(`Failed to count today's pack openings: ${error.message}`);
    return count ?? 0;
  }

  /** Authenticated per-user status the frontend uses to show/hide the "you've hit today's limit"
   *  message before ever offering payment — mirrors isTreasuryFunded's "tell the user why up
   *  front" approach rather than letting them tap pay into a guaranteed rejection. */
  async getMyPackStatus(userId: string): Promise<{ opensToday: number; dailyLimit: number | null; limitReached: boolean }> {
    const [opensToday, dailyLimit] = await Promise.all([this.getOpensToday(userId), this.getDailyOpenLimit()]);
    return { opensToday, dailyLimit, limitReached: dailyLimit !== null && opensToday >= dailyLimit };
  }

  /** Admin: recent pack openings (real + demo), newest first — paginated the same way
   *  listGifts is in admin-lottery.controller.ts. */
  async getAdminOpenings(page: number, pageSize: number): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const db = this.supabase.getClient();
    const { data, count, error } = await db
      .from('pack_openings')
      .select('id, created_at, user_id, tier_key, tickets_awarded, rarity, cost_usdc, is_test, payment_tx_hash, lottery_ticket_id, status, purchase_failure_reason, retry_count', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(`Failed to load pack openings: ${error.message}`);
    return { data: data ?? [], total: count ?? 0, page, limit: pageSize };
  }

  /**
   * Builds the $2 payment transfer for the user to sign client-side — a plain public USDC
   * transfer (no MagicBlock privacy, no bridging: this only ever needs to land in Loofta's own
   * treasury on the same chain). Mirrors LotteryService.buildPublicBurnerTransferTx: the
   * treasury/fee wallet partial-signs as fee payer (sponsoring gas + idempotently creating its
   * own destination ATA if somehow missing) so the user only ever needs to provide one
   * signature, then send the result to POST /packs/open as paymentTxHash.
   *
   * Refuses to build the charge at all if the treasury can't currently cover a payout, or if this
   * user has already hit today's per-user open limit — this is the enforcement point, not
   * openPack: by the time openPack runs the user has already paid, so refusing there would just
   * strand ANOTHER payment (see the double-payment incident this feature is meant to prevent a
   * repeat of). Blocking here means nobody ever pays into a pack we can't/won't let them open.
   */
  async buildPaymentTx(userSolanaAddress: string, userId: string): Promise<string> {
    if (!(await this.isTreasuryFunded())) {
      throw new BadRequestException('Mystery Packs are temporarily unavailable — please check back soon');
    }
    const { limitReached } = await this.getMyPackStatus(userId);
    if (limitReached) {
      throw new BadRequestException("You've reached today's Mystery Pack limit — come back tomorrow!");
    }
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    const treasuryKeypair = Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));

    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromPubkey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, USDC_MINT),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(PACK_PRICE_USDC * 1_000_000)),
    ];

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: treasuryKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]); // sponsors gas + destination ATA rent; user signs client-side

    return Buffer.from(tx.serialize()).toString('base64');
  }

  /**
   * Finds, across every token balance touched by the tx (not just the treasury's), the account
   * that was DEBITED the most USDC, and returns its owner. This is how a payment's real sender
   * is identified — `preTokenBalances`/`postTokenBalances` never say "who sent this," only what
   * every touched account held before/after.
   */
  private findUsdcDebitOwner(tx: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>, usdcMint: string): { owner: string | null; amount: bigint } {
    const preByIdx = new Map((tx.meta?.preTokenBalances ?? []).map(b => [b.accountIndex, b]));
    const postByIdx = new Map((tx.meta?.postTokenBalances ?? []).map(b => [b.accountIndex, b]));
    let debitOwner: string | null = null;
    let maxDebit = 0n;
    for (const [idx, post] of postByIdx) {
      if (post.mint !== usdcMint) continue;
      const pre = preByIdx.get(idx);
      if (!pre || pre.mint !== usdcMint) continue;
      const delta = BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount); // positive = debited
      if (delta > maxDebit) { maxDebit = delta; debitOwner = post.owner ?? pre.owner ?? null; }
    }
    return { owner: debitOwner, amount: maxDebit };
  }

  /**
   * Verifies ON-CHAIN that `txHash` is a confirmed transaction that (a) credited the treasury
   * wallet with at least `expectedUsdc` USDC AND (b) was actually paid BY `expectedSender` —
   * without (b), any confirmed transaction that ever moved ≥$2 USDC into the treasury (e.g. an
   * unrelated ticket-purchase fee from a completely different user) could be replayed as a "pack
   * payment" by anyone who knows the treasury address is public, opening a free pack that still
   * triggers a real treasury-funded ticket purchase — i.e. a fee-wallet drain vector. Retries
   * because the frontend posts the hash immediately after sending, often before it's 'confirmed'.
   */
  private async verifyPackPaymentOnChain(txHash: string, expectedUsdc: number, expectedSender: string, retries = 5): Promise<void> {
    const treasury = await this.getTreasuryAddress();
    const conn = await this.getSolanaConnection();
    const usdcMint = USDC_MINT.toBase58();

    for (let attempt = 0; ; attempt++) {
      const tx = await conn.getTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx) {
        if (tx.meta?.err) throw new BadRequestException('Payment transaction failed on-chain');
        const pre = tx.meta?.preTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const post = tx.meta?.postTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
        const expectedUnits = BigInt(Math.round(expectedUsdc * 1_000_000));
        if (received < expectedUnits) {
          throw new BadRequestException(`Pack payment paid ${received} units, expected ${expectedUnits}`);
        }
        const debit = this.findUsdcDebitOwner(tx, usdcMint);
        if (debit.owner !== expectedSender) {
          throw new BadRequestException('This payment was not sent from your wallet');
        }
        return;
      }
      if (attempt >= retries) throw new BadRequestException('Payment transaction not found on-chain — wait a few seconds and retry');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  /**
   * Looks for a real, confirmed, unconsumed pack payment this user already sent — e.g. a payment
   * whose on-chain send actually landed but whose client-side flow never made it to POST
   * /packs/open (network hiccup, closed tab, refresh mid-request). Without this, that money is
   * simply lost from the user's perspective and, worse, nothing stops them from paying a SECOND
   * time for the same intended pack. Scans the treasury's recent incoming USDC transfers rather
   * than trusting any client-supplied hash, and skips anything already recorded in pack_openings
   * (already consumed) or not sent from this exact user's own wallet.
   */
  async findRecoverablePayment(userId: string): Promise<{ paymentTxHash: string } | null> {
    try {
      const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
      const treasury = await this.getTreasuryAddress();
      const usdcMint = USDC_MINT.toBase58();
      const treasuryAta = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(treasury));
      const conn = await this.getSolanaConnection();
      const sigs = await conn.getSignaturesForAddress(treasuryAta, { limit: 30 });
      const cutoffMs = Date.now() - RECOVERABLE_PAYMENT_WINDOW_MS;
      const db = this.supabase.getClient();

      for (const sigInfo of sigs) {
        if (sigInfo.err) continue;
        // Signatures come back newest-first — once we hit one older than the recovery window,
        // everything after it is too, so stop scanning instead of walking further back.
        if (!sigInfo.blockTime || sigInfo.blockTime * 1000 < cutoffMs) break;

        const { data: existing } = await db.from('pack_openings').select('id').eq('payment_tx_hash', sigInfo.signature).maybeSingle();
        if (existing) continue; // already consumed by a real pack open

        const tx = await conn.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx || tx.meta?.err) continue;
        const pre = tx.meta?.preTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const post = tx.meta?.postTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
        if (received < BigInt(Math.round(PACK_PRICE_USDC * 1_000_000))) continue;

        const debit = this.findUsdcDebitOwner(tx, usdcMint);
        if (debit.owner !== userSolanaAddress) continue;

        return { paymentTxHash: sigInfo.signature };
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`findRecoverablePayment ${userId}: ${e.message}`);
      return null;
    }
  }

  private async loadTiers(): Promise<PackTierConfig[]> {
    if (this.tiersCache && Date.now() - this.tiersCache.loadedAt < this.TIERS_CACHE_MS) {
      return this.tiersCache.tiers;
    }
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('pack_tiers')
      .select('tier_key, tickets_awarded, weight, rarity, enabled, display_order')
      .order('display_order', { ascending: true });
    if (error) throw new Error(`Failed to load pack tiers: ${error.message}`);

    const tiers: PackTierConfig[] = (data ?? []).map((row: any) => ({
      tierKey: row.tier_key,
      ticketsAwarded: row.tickets_awarded,
      weight: Number(row.weight),
      rarity: row.rarity,
      enabled: row.enabled,
      displayOrder: row.display_order,
    }));
    this.tiersCache = { tiers, loadedAt: Date.now() };
    return tiers;
  }

  /**
   * Public tier ladder for display — tickets + rarity only. Never returns weight or enabled:
   * a currently-disabled tier renders identically to an enabled one, so flipping it on later
   * (via the admin toggle) needs zero frontend change and no user-visible transition.
   * Also carries the treasury address + USDC mint the frontend needs to build the payment
   * transfer — the amount (priceUsdc) is authoritative here; the frontend must not hardcode it.
   */
  async getPublicConfig(): Promise<{ priceUsdc: number; treasuryAddress: string; usdcMint: string; available: boolean; tiers: PackTierPublic[] }> {
    const [tiers, treasuryAddress, available] = await Promise.all([this.loadTiers(), this.getTreasuryAddress(), this.isTreasuryFunded()]);
    return {
      priceUsdc: PACK_PRICE_USDC,
      treasuryAddress,
      usdcMint: USDC_MINT.toBase58(),
      // False when the treasury can't currently cover a payout — the frontend should show packs
      // as paused rather than let anyone pay into one we can't fund the win for.
      available,
      tiers: tiers.map(t => ({
        tierKey: t.tierKey,
        ticketsAwarded: t.ticketsAwarded,
        rarity: t.rarity,
        displayOrder: t.displayOrder,
      })),
    };
  }

  /**
   * Rolls a prize tier using the full published odds table — every tier, enabled or not — so
   * disabling a tier never shifts the relative odds of the others (the 1/2/5/10 ratios you asked
   * for stay exactly as specified either way). If the roll lands on a disabled tier, it falls
   * back to the next-lower-tickets *enabled* tier: with 50 and 100 disabled today, those draws
   * currently just pay out as 10 tickets. Uses crypto.randomInt rather than Math.random since
   * this determines a real payout.
   */
  private async rollTier(): Promise<PackTierConfig> {
    const tiers = await this.loadTiers();
    if (!tiers.length) throw new Error('No pack tiers configured');

    const scaled = tiers.map(t => ({ tier: t, weight: Math.max(1, Math.round(t.weight * WEIGHT_SCALE)) }));
    const total = scaled.reduce((sum, s) => sum + s.weight, 0);

    const roll = randomInt(0, total);
    let cumulative = 0;
    let landed = scaled[scaled.length - 1].tier;
    for (const s of scaled) {
      cumulative += s.weight;
      if (roll < cumulative) {
        landed = s.tier;
        break;
      }
    }

    if (landed.enabled) return landed;

    const enabledByTickets = tiers.filter(t => t.enabled).sort((a, b) => a.ticketsAwarded - b.ticketsAwarded);
    const fallback = [...enabledByTickets].reverse().find(t => t.ticketsAwarded <= landed.ticketsAwarded);
    return fallback ?? enabledByTickets[0] ?? landed;
  }

  /**
   * Opens a pack for a user after verifying the $2 payment on-chain. `paymentTxHash` must be a
   * confirmed transaction that sent at least PACK_PRICE_USDC in USDC to the treasury wallet FROM
   * this exact user's own wallet — verified here, never trusted from the client. A tx hash can
   * only ever fund one pack open: checked up front (fast path, good error message) and enforced
   * for real by the DB's partial unique index on payment_tx_hash
   * (pack_openings_payment_tx_hash_uq), which is what actually closes the race between two
   * concurrent requests reusing the same hash.
   */
  async openPack(userId: string, paymentTxHash: string): Promise<PackOpenResult> {
    const db = this.supabase.getClient();

    const { data: existing } = await db
      .from('pack_openings')
      .select('id')
      .eq('payment_tx_hash', paymentTxHash)
      .maybeSingle();
    if (existing) throw new BadRequestException('This payment has already been used to open a pack');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.verifyPackPaymentOnChain(paymentTxHash, PACK_PRICE_USDC, userSolanaAddress);

    const tier = await this.rollTier();
    const { data, error } = await db
      .from('pack_openings')
      .insert({
        user_id: userId,
        tier_key: tier.tierKey,
        tickets_awarded: tier.ticketsAwarded,
        rarity: tier.rarity,
        cost_usdc: PACK_PRICE_USDC,
        is_test: false,
        payment_tx_hash: paymentTxHash,
        status: 'opened',
      })
      .select('id')
      .single();
    if (error) {
      // Postgres unique_violation — the payment_tx_hash race guard tripped (see index comment
      // in the migration). The payment is real and already recorded against another open; don't
      // let this one silently retry and double-spend it.
      if ((error as any).code === '23505') {
        throw new BadRequestException('This payment has already been used to open a pack');
      }
      throw new Error(`Failed to record pack opening: ${error.message}`);
    }
    if (!data) throw new Error('Failed to record pack opening: no row returned');

    this.logger.log(`Pack opened for user ${userId}: tier=${tier.tierKey} tickets=${tier.ticketsAwarded} payment=${paymentTxHash}`);

    // The prize is already locked in above — a failure here must never take the pack open down
    // with it. fulfillPackOpening catches internally and leaves the row retryable instead.
    await this.fulfillPackOpening(data.id, userId, tier.ticketsAwarded);

    return {
      id: data.id,
      tierKey: tier.tierKey,
      ticketsAwarded: tier.ticketsAwarded,
      rarity: tier.rarity,
    };
  }

  /**
   * Dev-only path for testing the open flow with no money involved at all: same real tier roll
   * as openPack, but no payment is ever required or verified, and — critically — no treasury-
   * funded ticket purchase ever fires (fulfillPackOpening is never called), so a demo open can
   * never cost Loofta's treasury anything either. Hard-blocked outside non-production
   * environments regardless of what the frontend sends, since this is the one path in the module
   * that skips the "never trust the client" payment verification on purpose — except for
   * DEMO_MODE_ALLOWED_USER_ID, who can use it in production too.
   */
  async openPackDemo(userId: string): Promise<PackOpenResult> {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    if (isProd && userId !== DEMO_MODE_ALLOWED_USER_ID) {
      throw new BadRequestException('Demo packs are not available in production');
    }

    const tier = await this.rollTier();
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('pack_openings')
      .insert({
        user_id: userId,
        tier_key: tier.tierKey,
        tickets_awarded: tier.ticketsAwarded,
        rarity: tier.rarity,
        cost_usdc: 0,
        is_test: true,
        payment_tx_hash: null,
        status: 'opened',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`Failed to record demo pack opening: ${error?.message}`);

    this.logger.log(`Demo pack opened for user ${userId}: tier=${tier.tierKey} tickets=${tier.ticketsAwarded} (no payment, no real ticket purchase)`);
    return {
      id: data.id,
      tierKey: tier.tierKey,
      ticketsAwarded: tier.ticketsAwarded,
      rarity: tier.rarity,
    };
  }

  /**
   * Buys the real Megapot ticket(s) a pack win entitles the user to, funded from Loofta's own
   * treasury (LotteryService.purchaseTicketsForUser — same admin_treasury funding model as an
   * admin-gifted ticket, minus the gift/claim indirection since the winner is already known).
   * Never throws: the win is already recorded in pack_openings by the time this runs, so a
   * failure just leaves the row status='failed' for retryFailedPackPurchases to pick up
   * instead of losing the user's prize.
   */
  private async fulfillPackOpening(openingId: string, userId: string, numTickets: number): Promise<void> {
    const db = this.supabase.getClient();
    try {
      const { ticketId } = await this.lottery.purchaseTicketsForUser(userId, numTickets);
      await db.from('pack_openings').update({ status: 'fulfilled', lottery_ticket_id: ticketId }).eq('id', openingId);
      this.logger.log(`Pack opening ${openingId}: fulfilled with real ticket ${ticketId}`);
    } catch (e: any) {
      this.logger.error(`Pack opening ${openingId}: ticket purchase failed, will retry: ${e.message}`);
      await db.from('pack_openings')
        .update({ status: 'failed', purchase_failure_reason: e.message })
        .eq('id', openingId);
    }
  }

  /**
   * Cron-driven retry for pack wins whose treasury-funded ticket purchase failed on the first
   * attempt (e.g. a transient RPC error, fee-wallet hiccup). Capped at MAX_PACK_PURCHASE_RETRIES
   * and a rolling age window, same shape as LotteryService.autoRetryFailedTickets.
   */
  async retryFailedPackPurchases(): Promise<void> {
    if (this.processingPackPurchaseRetry) return;
    this.processingPackPurchaseRetry = true;
    try {
      const db = this.supabase.getClient();
      const cutoff = new Date(Date.now() - PACK_PURCHASE_RETRY_MAX_AGE_MS).toISOString();
      const { data: openings } = await db
        .from('pack_openings')
        .select('id, user_id, tickets_awarded, retry_count')
        .eq('status', 'failed')
        .lt('retry_count', MAX_PACK_PURCHASE_RETRIES)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(10);

      for (const opening of openings ?? []) {
        await db.from('pack_openings').update({ retry_count: opening.retry_count + 1 }).eq('id', opening.id);
        await this.fulfillPackOpening(opening.id, opening.user_id, opening.tickets_awarded);
      }
    } finally {
      this.processingPackPurchaseRetry = false;
    }
  }

  /** Admin: full tier config including weight + enabled — powers the enable/disable toggle. */
  async getAdminTiers(): Promise<PackTierConfig[]> {
    this.tiersCache = null;
    return this.loadTiers();
  }

  /** Admin: flip a tier's enabled flag. Weights are never touched — see rollTier's fallback. */
  async setTierEnabled(tierKey: string, enabled: boolean): Promise<PackTierConfig> {
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('pack_tiers')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('tier_key', tierKey)
      .select('tier_key, tickets_awarded, weight, rarity, enabled, display_order')
      .single();
    if (error || !data) throw new BadRequestException(`Unknown pack tier: ${tierKey}`);

    this.tiersCache = null;
    return {
      tierKey: data.tier_key,
      ticketsAwarded: data.tickets_awarded,
      weight: Number(data.weight),
      rarity: data.rarity,
      enabled: data.enabled,
      displayOrder: data.display_order,
    };
  }
}
