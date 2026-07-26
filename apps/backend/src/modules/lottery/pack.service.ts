import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';

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

@Injectable()
export class PackService {
  private readonly logger = new Logger(PackService.name);

  // Tier config changes only via an admin toggle, so a short cache avoids a DB round trip on
  // every "open pack" click without risking meaningfully stale odds.
  private tiersCache: { tiers: PackTierConfig[]; loadedAt: number } | null = null;
  private readonly TIERS_CACHE_MS = 10_000;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
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

  /**
   * Builds the $2 payment transfer for the user to sign client-side — a plain public USDC
   * transfer (no MagicBlock privacy, no bridging: this only ever needs to land in Loofta's own
   * treasury on the same chain). Mirrors LotteryService.buildPublicBurnerTransferTx: the
   * treasury/fee wallet partial-signs as fee payer (sponsoring gas + idempotently creating its
   * own destination ATA if somehow missing) so the user only ever needs to provide one
   * signature, then send the result to POST /packs/open as paymentTxHash.
   */
  async buildPaymentTx(userSolanaAddress: string): Promise<string> {
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
   * Verifies ON-CHAIN that `txHash` is a confirmed transaction that credited the treasury
   * wallet with at least `expectedUsdc` USDC. Mirrors LotteryService.verifyFeePaymentOnChain —
   * NEVER trust the client-supplied hash or amount. Retries because the frontend posts the hash
   * immediately after sending, often before the tx reaches 'confirmed'.
   */
  private async verifyPackPaymentOnChain(txHash: string, expectedUsdc: number, retries = 5): Promise<void> {
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
        return;
      }
      if (attempt >= retries) throw new BadRequestException('Payment transaction not found on-chain — wait a few seconds and retry');
      await new Promise(r => setTimeout(r, 2000));
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
  async getPublicConfig(): Promise<{ priceUsdc: number; treasuryAddress: string; usdcMint: string; tiers: PackTierPublic[] }> {
    const [tiers, treasuryAddress] = await Promise.all([this.loadTiers(), this.getTreasuryAddress()]);
    return {
      priceUsdc: PACK_PRICE_USDC,
      treasuryAddress,
      usdcMint: USDC_MINT.toBase58(),
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
   * confirmed transaction that sent at least PACK_PRICE_USDC in USDC to the treasury wallet —
   * verified here, never trusted from the client. A tx hash can only ever fund one pack open:
   * checked up front (fast path, good error message) and enforced for real by the DB's partial
   * unique index on payment_tx_hash (pack_openings_payment_tx_hash_uq), which is what actually
   * closes the race between two concurrent requests reusing the same hash.
   */
  async openPack(userId: string, paymentTxHash: string): Promise<PackOpenResult> {
    const db = this.supabase.getClient();

    const { data: existing } = await db
      .from('pack_openings')
      .select('id')
      .eq('payment_tx_hash', paymentTxHash)
      .maybeSingle();
    if (existing) throw new BadRequestException('This payment has already been used to open a pack');

    await this.verifyPackPaymentOnChain(paymentTxHash, PACK_PRICE_USDC);

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
    return {
      id: data.id,
      tierKey: tier.tierKey,
      ticketsAwarded: tier.ticketsAwarded,
      rarity: tier.rarity,
    };
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
