import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey, Connection, Transaction, VersionedTransaction, TransactionMessage, SystemProgram } from '@solana/web3.js';
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { MegapotService, MEGAPOT_USDC, MEGAPOT_JACKPOT, JACKPOT_ABI } from './megapot.service';
import { RhinestoneService } from './rhinestone.service';
import { LifiService } from './lifi.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { requestMagicblockPrivateTransfer, estimateMagicblockGrossUp, MAGICBLOCK_GAS_USDC, MAGICBLOCK_GAS_SOL, MAGICBLOCK_VOLUME_FEE_BPS, fetchSolPriceUsd } from '@/common/magicblock-private-transfer';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TICKET_PRICE_USDC = 1;
// A SOL→Base Li.Fi bridge normally quotes single-digit-seconds execution — 20 min with zero
// destination-side activity means the bridge tool's solver network has abandoned the order,
// not that it's "just slow". Past this, stop waiting and make the user whole ourselves.
const BRIDGE_STALL_TIMEOUT_MS = 20 * 60_000;
// New private purchases stop 5 min before the draw (draw is 7:10 PM CET daily) — a purchase
// started right at the wire could still be mid-bridge when the round is drawn, buying a ticket
// that can never win. Reopens automatically once Megapot's API reports the next round.
const DRAW_PURCHASE_CUTOFF_MS = 5 * 60_000;
// Per-purchase fee: flat component + proportional component, calibrated to break even against
// the REAL Sol→Base Li.Fi cost (live-quoted, not assumed) plus a thin buffer for quote
// volatility — this fee only needs to cover bridging, not be a profit center (the referral
// win-share cut on winners' payouts is the actual margin, see getWinClaimFactor). The old
// $0.10+30bps figure was calibrated against an assumed ~25bps bridging cost; live quotes show
// the real cost is ~0.4-0.5% via Across under ~$5, then plateaus ~1.28-1.32% via NEAR Intents
// above that — the old formula went net-negative above ~10 tickets. $0.03+150bps tracks both
// regimes with ~20-60% headroom instead of a flat guess.
const LOOFTA_TICKET_FEE_FLAT_USDC = 0.03;
const LOOFTA_TICKET_FEE_BPS = 150;
function looftaTicketFee(costUsdc: number): number {
  return parseFloat((LOOFTA_TICKET_FEE_FLAT_USDC + (costUsdc * LOOFTA_TICKET_FEE_BPS) / 10_000).toFixed(6));
}

const SWAP_ROUTER_02: Address = '0x2626664c2603336E57B271c5C0b26F421741e481';
const WETH9_BASE: Address = '0x4200000000000000000000000000000000000006';
const LOOFTA_WALLET: Address = '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39';
const ETH_GAS_RESERVE = 50_000_000_000_000n; // 0.00005 ETH — well above Base gas costs (~0.000004 ETH per tx)

// Static NEAR Intents asset IDs — hardcoded to avoid the getTokens() API call on every purchase
const NEAR_ASSET_SOL_USDC = 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near';
const NEAR_ASSET_BASE_ETH = 'nep141:base.omft.near';
const NEAR_ASSET_BASE_USDC = 'nep141:usdc.base.omft.near';
const NEAR_ASSET_SOL_USDC_CHAIN = 'solana';
const NEAR_ASSET_BASE_ETH_CHAIN = 'base';
const NEAR_ASSET_BASE_USDC_CHAIN = 'base';

const SWAP_ROUTER_ABI = [
  {
    name: 'exactOutputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'amountOut', type: 'uint256' },
        { name: 'amountInMaximum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ]
    }],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
  {
    name: 'refundETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const;

export type TicketStatus =
  | 'pending_send'
  | 'sent'
  | 'bridging'
  | 'buying'
  | 'active'
  | 'won'
  | 'lost'
  | 'failed';

export interface InitiatePurchaseResult {
  ticketId: string;
  /** Sign + send this FIRST — plain USDC transfer collecting Loofta's fee upfront. */
  feeTxBase64: string;
  feeWalletAddress: string;
  /** Sign + send this SECOND, after the fee tx confirms — the MagicBlock private transfer. */
  txBase64: string;
  requiredSigners: string[];
  feeBreakdown: {
    ticketCostUsdc: number;
    magicblockFeeUsdc: number;
    looftaFeeUsdc: number;
    totalUsdc: number;
  };
}

export interface InitiatePublicPurchaseResult {
  ticketId: string;
  depositAddress: string;
  amountUsdc: number;
}

export interface LotteryDashboard {
  activeTickets: LotteryTicketSummary[];
  history: LotteryTicketSummary[];
  withdrawals: LotteryWithdrawalSummary[];
  stats: { totalSpent: number; totalWon: number; netPnl: number; ticketCount: number };
  nextDraw: { roundId: string | null; drawTime: string | null; prizePool: string | null };
}

export interface LotteryTicketSummary {
  id: string;
  status: TicketStatus;
  numTickets: number;
  costUsdc: number;
  roundId: string | null;
  drawTime: string | null;
  winAmountUsdc: number | null;
  winTier: number | null;
  createdAt: string;
  depositAddress: string | null;
  bridgeStatus: string | null;
  bridgeExpiresAt: string | null;
  ticketNumbers: { main: number[]; bonus: number }[] | null;
  winningNumbers: { main: number[]; bonus: number } | null;
}

export interface LotteryWithdrawalSummary {
  id: string;
  ticketId: string;
  route: 'base' | 'solana_private';
  destinationAddress: string;
  amountUsdc: number;
  status: string;
  createdAt: string;
}

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly nearIntents: NearIntentsService,
    private readonly enc: SendPaymentEncryptionService,
    private readonly megapot: MegapotService,
    private readonly rhinestone: RhinestoneService,
    private readonly lifi: LifiService,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Purchase initiation ───────────────────────────────────────────────────

  /** Blocks new purchases in the last DRAW_PURCHASE_CUTOFF_MS before the active round draws. */
  private async assertNotInDrawCutoff(): Promise<void> {
    let drawTime: string | null = null;
    try {
      drawTime = (await this.megapot.getActiveRound())?.drawTime ?? null;
    } catch (e: any) {
      this.logger.warn(`assertNotInDrawCutoff: could not fetch active round, allowing purchase: ${e.message}`);
      return;
    }
    if (!drawTime) return;

    const msUntilDraw = new Date(drawTime).getTime() - Date.now();
    if (msUntilDraw > 0 && msUntilDraw <= DRAW_PURCHASE_CUTOFF_MS) {
      throw new BadRequestException(
        `Ticket sales are paused for the next few minutes while this round finishes — the draw is at ${new Date(drawTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Paris' })} CET. Try again just after.`,
      );
    }
  }

  async initiatePurchase(opts: {
    userId: string;
    numTickets: number;
    userSolanaAddress: string;
  }): Promise<InitiatePurchaseResult> {
    const { userId, numTickets, userSolanaAddress } = opts;
    await this.assertNotInDrawCutoff();
    if (numTickets < 1 || numTickets > 100) throw new BadRequestException('1–100 tickets per private purchase');

    // Load protection: each initiation creates wallets, calls MagicBlock, and builds sponsored
    // txs — cap unsigned purchases per user so the endpoint can't be spammed. Time-boxed to the
    // last 15 min so abandoned-before-fee tickets (which no cron cleans up) can't lock a user
    // out permanently.
    const db0 = this.supabase.getClient();
    const { count: pendingCount } = await db0
      .from('lottery_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending_send')
      .not('burner_sol_address', 'is', null)
      .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString());
    if ((pendingCount ?? 0) >= 3) {
      throw new BadRequestException('You have unfinished purchases — complete or cancel them first, or retry in a few minutes.');
    }

    // 1. Generate companion wallet owner key and compute its Rhinestone smart account address
    const companionPrivKey = generatePrivateKey();
    const companionAddress = await this.rhinestone.getCompanionAddress(companionPrivKey);

    // 2. Generate burner Solana wallet (receives MagicBlock transfer, bridges to Base)
    const burnerKeypair = Keypair.generate();
    const burnerAddress = burnerKeypair.publicKey.toBase58();

    // 3. Encrypt keys for DB storage (context = companion address for HKDF)
    const companionKeyEnc = this.enc.encrypt(Buffer.from(companionPrivKey.slice(2), 'hex'), companionAddress);
    const burnerKeyEnc = this.enc.encrypt(Buffer.from(burnerKeypair.secretKey), burnerAddress);

    const costUsdc = numTickets * TICKET_PRICE_USDC;
    const costUnits = Math.round(costUsdc * 1_000_000);

    // Estimate only, for the fee breakdown display — the real transfer sends the clean
    // `costUnits` with exactOut:true and lets MagicBlock gross up the sender's debit internally.
    const grossAmount = estimateMagicblockGrossUp(costUnits);
    const magicblockFeeUsdc = parseFloat(((grossAmount - costUnits) / 1_000_000 + MAGICBLOCK_GAS_USDC).toFixed(6));
    const looftaFeeUsdc = looftaTicketFee(costUsdc);
    const totalUsdc = costUsdc + magicblockFeeUsdc + looftaFeeUsdc;

    // 4. Fee collection: a plain USDC transfer, user → fee wallet, BEFORE the MagicBlock
    // transfer — we can't append this as an instruction onto MagicBlock's own pre-built tx, so
    // it has to be its own transaction. The frontend signs+sends this one first.
    const { transactionBase64: feeTxBase64, feeWalletAddress } = await this.buildFeeCollectionTx(
      userSolanaAddress, looftaFeeUsdc,
    );

    // 5. Build MagicBlock private transfer: user → burner. Amount is exactly costUsdc — already
    // a whole-dollar figure for any ticket count, so no rounding is needed for the exactOut leg
    // to avoid fingerprinting. Li.Fi's bridging cost is funded later from the fee wallet, not
    // baked into this amount (see tryStartBridge).
    const cluster = this.getSolanaCluster();
    let txResponse: Awaited<ReturnType<typeof requestMagicblockPrivateTransfer>>;
    try {
      txResponse = await requestMagicblockPrivateTransfer({
        from: userSolanaAddress,
        to: burnerAddress,
        mint: USDC_MINT.toBase58(),
        amount: costUnits,
        cluster,
        exactOut: true,
        gasless: true,
        minDelayMs: 10_000,
        maxDelayMs: 30_000,
      });
    } catch (err: any) {
      if (String(err?.message).includes('delegated to another validator')) {
        throw new BadRequestException(
          'A previous payment from this wallet is still in transit (usually clears within 2 minutes). Please wait and try again.',
        );
      }
      throw err;
    }

    // 6. Store ticket in DB
    const db = this.supabase.getClient();
    const { data: ticket, error } = await db
      .from('lottery_tickets')
      .insert({
        user_id: userId,
        user_solana_address: userSolanaAddress,
        companion_address: companionAddress,
        companion_key_enc: companionKeyEnc,
        burner_sol_address: burnerAddress,
        burner_sol_key_enc: burnerKeyEnc,
        num_tickets: numTickets,
        cost_usdc: costUsdc,
        status: 'pending_send',
      })
      .select('id')
      .single();

    if (error || !ticket) throw new Error(`Failed to create lottery ticket: ${error?.message}`);

    return {
      ticketId: ticket.id,
      feeTxBase64,
      feeWalletAddress,
      txBase64: txResponse.transactionBase64,
      requiredSigners: txResponse.requiredSigners,
      feeBreakdown: { ticketCostUsdc: costUsdc, magicblockFeeUsdc, looftaFeeUsdc, totalUsdc },
    };
  }

  // ─── Gift a ticket ──────────────────────────────────────────────────────────

  private normalizeGiftIdentifier(type: 'email' | 'handle', value: string): string {
    const v = value.trim();
    return type === 'email' ? v.toLowerCase() : v.replace(/^@/, '').toLowerCase();
  }

  /**
   * Self-service gift: a user pays for N tickets with their own wallet — same signed private
   * transfer as buying for themselves in initiatePurchase — but the actual Megapot purchase is
   * deferred to CLAIM time, exactly like admin-issued gifts (see createGift/purchaseGiftTickets).
   * No lottery_tickets row, no companion wallet, and no email is created here — only once
   * confirmGiftSend lands does the gift become real and the recipient gets notified. This is
   * deliberate: creating a lottery_tickets row now would let the existing purchase crons pick it
   * up and buy a real ticket (numbers, draw entry) before anyone has claimed it, which is exactly
   * what admin gifts were built to avoid.
   *
   * The sender's payment lands in a holding burner tracked on lottery_gifts (burner_sol_address/
   * burner_sol_key_enc) — reused as-is by purchaseGiftTickets at claim time instead of being
   * funded fresh from treasury like admin_treasury gifts.
   */
  async initiateGiftedPurchase(opts: {
    userId: string;
    userSolanaAddress: string;
    numTickets: number;
    recipientType: 'email' | 'handle';
    recipientIdentifier: string;
    note?: string;
  }): Promise<{ giftId: string; feeTxBase64: string; feeWalletAddress: string; txBase64: string; requiredSigners: string[] }> {
    const { userId, userSolanaAddress, numTickets } = opts;
    await this.assertNotInDrawCutoff();
    if (!numTickets || numTickets < 1 || numTickets > 100) throw new BadRequestException('1–100 tickets per gift');
    if (!['email', 'handle'].includes(opts.recipientType)) throw new BadRequestException('recipientType must be "email" or "handle"');
    const recipientIdentifier = this.normalizeGiftIdentifier(opts.recipientType, opts.recipientIdentifier);
    if (!recipientIdentifier) throw new BadRequestException('recipientIdentifier required');

    // Same load protection as initiatePurchase, but against unconfirmed gift payments instead.
    const db0 = this.supabase.getClient();
    const { count: pendingCount } = await db0
      .from('lottery_gifts')
      .select('id', { count: 'exact', head: true })
      .eq('created_by_user_id', userId)
      .eq('status', 'pending_payment')
      .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString());
    if ((pendingCount ?? 0) >= 3) {
      throw new BadRequestException('You have unfinished gift purchases — complete or cancel them first, or retry in a few minutes.');
    }

    const burnerKeypair = Keypair.generate();
    const burnerAddress = burnerKeypair.publicKey.toBase58();
    const burnerKeyEnc = this.enc.encrypt(Buffer.from(burnerKeypair.secretKey), burnerAddress);

    const costUsdc = numTickets * TICKET_PRICE_USDC;
    const costUnits = Math.round(costUsdc * 1_000_000);
    const looftaFeeUsdc = looftaTicketFee(costUsdc);

    // Fee collection: a plain USDC transfer, user → fee wallet, same as initiatePurchase — has to
    // be its own transaction, can't be appended to MagicBlock's own pre-built tx.
    const { transactionBase64: feeTxBase64, feeWalletAddress } = await this.buildFeeCollectionTx(
      userSolanaAddress, looftaFeeUsdc,
    );

    const cluster = this.getSolanaCluster();
    let txResponse: Awaited<ReturnType<typeof requestMagicblockPrivateTransfer>>;
    try {
      txResponse = await requestMagicblockPrivateTransfer({
        from: userSolanaAddress,
        to: burnerAddress,
        mint: USDC_MINT.toBase58(),
        amount: costUnits,
        cluster,
        exactOut: true,
        gasless: true,
        minDelayMs: 10_000,
        maxDelayMs: 30_000,
      });
    } catch (err: any) {
      if (String(err?.message).includes('delegated to another validator')) {
        throw new BadRequestException(
          'A previous payment from this wallet is still in transit (usually clears within 2 minutes). Please wait and try again.',
        );
      }
      throw err;
    }

    const db = this.supabase.getClient();
    const claimToken = randomUUID();
    const { data: gift, error: giftError } = await db
      .from('lottery_gifts')
      .insert({
        created_by_user_id: userId,
        funding_mode: 'sender_paid',
        num_tickets: numTickets,
        note: opts.note ?? null,
        recipient_type: opts.recipientType,
        recipient_identifier: recipientIdentifier,
        claim_token: claimToken,
        status: 'pending_payment',
        burner_sol_address: burnerAddress,
        burner_sol_key_enc: burnerKeyEnc,
      })
      .select('id')
      .single();
    if (giftError || !gift) throw new Error(`Failed to create gift record: ${giftError?.message}`);

    return {
      giftId: gift.id,
      feeTxBase64,
      feeWalletAddress,
      txBase64: txResponse.transactionBase64,
      requiredSigners: txResponse.requiredSigners,
    };
  }

  /** Confirm the sender's upfront fee tx — must be called before confirmGiftSend. */
  async confirmGiftFee(opts: { giftId: string; userId: string; feeTxHash: string }): Promise<void> {
    const db = this.supabase.getClient();
    const { data: gift } = await db
      .from('lottery_gifts')
      .select('num_tickets, fee_tx_hash')
      .eq('id', opts.giftId)
      .eq('created_by_user_id', opts.userId)
      .eq('funding_mode', 'sender_paid')
      .single();
    if (!gift) throw new BadRequestException('Gift not found');
    if (gift.fee_tx_hash === opts.feeTxHash) return; // idempotent retry
    if (gift.fee_tx_hash) throw new BadRequestException('Fee already recorded for this gift');

    const feeUsdc = looftaTicketFee(gift.num_tickets * TICKET_PRICE_USDC);
    await this.verifyFeePaymentOnChain(opts.feeTxHash, feeUsdc);

    const { error } = await db
      .from('lottery_gifts')
      .update({ fee_tx_hash: opts.feeTxHash })
      .eq('id', opts.giftId)
      .eq('created_by_user_id', opts.userId);
    if (error) throw new Error(`confirmGiftFee failed: ${error.message}`);
    this.logger.log(`Gift ${opts.giftId}: fee collected & verified on-chain, tx=${opts.feeTxHash}`);
  }

  /**
   * Confirm the sender's MagicBlock transfer landed — this is the moment the gift becomes real:
   * flips pending_payment → unclaimed and (for email gifts) sends the notification. Nothing
   * before this point is visible or claimable by the recipient.
   */
  async confirmGiftSend(opts: { giftId: string; userId: string; senderTxHash: string }): Promise<{ claimUrl: string }> {
    const db = this.supabase.getClient();
    const { data: gift } = await db
      .from('lottery_gifts')
      .select('*')
      .eq('id', opts.giftId)
      .eq('created_by_user_id', opts.userId)
      .eq('funding_mode', 'sender_paid')
      .single();
    if (!gift) throw new BadRequestException('Gift not found');
    const claimUrl = `https://pay.loofta.xyz/gift/${gift.claim_token}`;
    if (gift.status !== 'pending_payment') return { claimUrl }; // idempotent retry

    const { error } = await db
      .from('lottery_gifts')
      .update({ status: 'unclaimed', sender_tx_hash: opts.senderTxHash })
      .eq('id', opts.giftId)
      .eq('status', 'pending_payment');
    if (error) throw new Error(`confirmGiftSend failed: ${error.message}`);

    if (gift.recipient_type === 'email') {
      await this.emailService.sendGiftTicketEmail({
        recipientEmail: gift.recipient_identifier,
        numTickets: gift.num_tickets,
        claimUrl,
        note: gift.note,
      }).catch(e => this.logger.warn(`confirmGiftSend ${opts.giftId}: sendGiftTicketEmail failed: ${e.message}`));
    }
    this.logger.log(`Gift ${opts.giftId}: payment confirmed, now claimable — tx=${opts.senderTxHash}`);
    return { claimUrl };
  }

  /**
   * Admin action: creates a lightweight, unfunded gift record. No wallets are generated and no
   * money moves here — that's deliberate, see claimGift below. Mirrors the recipient-targeting
   * UX of a regular Loofta payment (email or X handle) without touching the payments/claims
   * tables at all.
   */
  async createGift(opts: {
    adminUserId: string;
    numTickets: number;
    recipientType: 'email' | 'handle';
    recipientIdentifier: string;
    note?: string;
  }): Promise<{ giftId: string; claimToken: string; claimUrl: string }> {
    const { adminUserId, numTickets, recipientType, note } = opts;
    if (!numTickets || numTickets < 1 || numTickets > 100) {
      throw new BadRequestException('1–100 tickets per gift');
    }
    if (!['email', 'handle'].includes(recipientType)) {
      throw new BadRequestException('recipientType must be "email" or "handle"');
    }
    const recipientIdentifier = this.normalizeGiftIdentifier(recipientType, opts.recipientIdentifier);
    if (!recipientIdentifier) throw new BadRequestException('recipientIdentifier required');

    const claimToken = randomUUID();
    const db = this.supabase.getClient();
    const { data: gift, error } = await db
      .from('lottery_gifts')
      .insert({
        created_by_user_id: adminUserId,
        funding_mode: 'admin_treasury',
        num_tickets: numTickets,
        note: note ?? null,
        recipient_type: recipientType,
        recipient_identifier: recipientIdentifier,
        claim_token: claimToken,
        status: 'unclaimed',
      })
      .select('id')
      .single();
    if (error || !gift) throw new Error(`Failed to create lottery gift: ${error?.message}`);

    const claimUrl = `https://pay.loofta.xyz/gift/${claimToken}`;
    if (recipientType === 'email') {
      await this.emailService.sendGiftTicketEmail({
        recipientEmail: recipientIdentifier,
        numTickets,
        claimUrl,
        note: note ?? null,
      }).catch(e => this.logger.warn(`createGift ${gift.id}: sendGiftTicketEmail failed: ${e.message}`));
    }

    this.logger.log(`Gift ${gift.id}: created ${numTickets} ticket(s) for ${recipientType}:${recipientIdentifier.slice(0, 3)}*** by admin ${adminUserId}`);
    return { giftId: gift.id, claimToken, claimUrl };
  }

  /** Public, unauthenticated preview for the claim page — no recipient identifier exposed. */
  async getGiftPublic(token: string, viewerUserId?: string): Promise<{
    numTickets: number; note: string | null; status: string; recipientType: 'email' | 'handle';
    isSender: boolean; isClaimant: boolean;
  }> {
    const db = this.supabase.getClient();
    const { data: gift } = await db
      .from('lottery_gifts')
      .select('num_tickets, note, status, recipient_type, created_by_user_id, claimed_by_user_id')
      .eq('claim_token', token)
      .maybeSingle();
    if (!gift) throw new NotFoundException('Gift not found');
    return {
      numTickets: gift.num_tickets,
      note: gift.note,
      status: gift.status,
      recipientType: gift.recipient_type,
      isSender: Boolean(viewerUserId) && gift.created_by_user_id === viewerUserId,
      isClaimant: Boolean(viewerUserId) && gift.claimed_by_user_id === viewerUserId,
    };
  }

  /**
   * Self-service gifts a user has sent (sender_paid only — admin-issued gifts aren't "theirs" to
   * track here). Once claimed, the underlying lottery_tickets row's ownership moves to the
   * recipient (see purchaseGiftTickets) and disappears from the sender's own ticket
   * dashboard/history — this is what lets a sender keep seeing "gifted to X, claimed" afterward.
   */
  async getMyGifts(userId: string, offset: number, limit: number): Promise<{
    gifts: {
      giftId: string;
      createdAt: string;
      numTickets: number;
      note: string | null;
      recipientType: 'email' | 'handle';
      recipientIdentifier: string;
      status: string;
      claimedAt: string | null;
      claimToken: string;
      claimUrl: string;
    }[];
    total: number;
  }> {
    const db = this.supabase.getClient();
    const { data: gifts, count } = await db
      .from('lottery_gifts')
      .select('id, created_at, num_tickets, note, recipient_type, recipient_identifier, status, claimed_at, claim_token', { count: 'exact' })
      .eq('created_by_user_id', userId)
      .eq('funding_mode', 'sender_paid')
      .neq('status', 'pending_payment') // abandoned mid-signature — not a real gift yet, nothing to show
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return {
      gifts: (gifts ?? []).map(g => ({
        giftId: g.id,
        createdAt: g.created_at,
        numTickets: g.num_tickets,
        note: g.note,
        recipientType: g.recipient_type,
        recipientIdentifier: g.recipient_identifier,
        status: g.status,
        claimedAt: g.claimed_at,
        claimToken: g.claim_token,
        claimUrl: `https://pay.loofta.xyz/gift/${g.claim_token}`,
      })),
      total: count ?? 0,
    };
  }

  /**
   * Recipient action: verifies identity, then does the real work — generates wallets, funds the
   * burner from Loofta's own fee wallet (no fee charged, no MagicBlock leg, no signed user tx),
   * and creates a normal lottery_tickets row already owned by the claimant. Buying at claim time
   * (not gift-creation time) means the ticket always enters whichever draw is live right now.
   */
  async claimGift(token: string, claimantPrivyUserId: string): Promise<{ ticketId: string; numTickets: number }> {
    const db = this.supabase.getClient();
    const { data: gift } = await db
      .from('lottery_gifts')
      .select('*')
      .eq('claim_token', token)
      .maybeSingle();
    if (!gift) throw new NotFoundException('Gift not found');

    // Idempotent retry: a prior claim got as far as flipping status='claimed' but the purchase
    // itself failed (e.g. fee-wallet funding failed, or getSolanaWalletAddress errored) — let the
    // same claimant retry without re-verifying identity or re-racing the atomic claim below.
    if (gift.status === 'claimed' && gift.claimed_by_user_id === claimantPrivyUserId) {
      if (!gift.resulting_ticket_id) return this.purchaseGiftTickets(gift, claimantPrivyUserId);
      return { ticketId: gift.resulting_ticket_id, numTickets: gift.num_tickets };
    }
    if (gift.status !== 'unclaimed') {
      const message = gift.status === 'claimed' ? 'This gift has already been claimed'
        : gift.status === 'pending_payment' ? 'This gift is still being set up — check back in a moment'
        : `This gift is ${gift.status}`;
      throw new BadRequestException(message);
    }

    // A gift addressed to a "handle" doesn't declare upfront whether it's an X handle or a
    // Loofta username — the sender picked one free-text field (matching how Send works), so try
    // both identity checks and accept either match.
    const matches = gift.recipient_type === 'handle'
      ? (await this.usersService.verifyRecipientIdentityForSendPayment(claimantPrivyUserId, 'twitter', gift.recipient_identifier))
        || (await this.usersService.verifyRecipientIdentityForSendPayment(claimantPrivyUserId, 'username', gift.recipient_identifier))
      : await this.usersService.verifyRecipientIdentityForSendPayment(claimantPrivyUserId, 'email', gift.recipient_identifier);
    if (!matches) {
      throw new ForbiddenException('You are not the intended recipient of this gift. Log in with the email, X account, or Loofta username it was sent to.');
    }

    // Atomic claim — same conditional-update race guard used for bridge_claimed_at (tryStartBridge).
    const { data: claimedRows, error: claimError } = await db
      .from('lottery_gifts')
      .update({ status: 'claimed', claimed_at: new Date().toISOString(), claimed_by_user_id: claimantPrivyUserId })
      .eq('id', gift.id)
      .eq('status', 'unclaimed')
      .select('id');
    if (claimError) throw new Error(`claimGift failed: ${claimError.message}`);
    if (!claimedRows?.length) throw new BadRequestException('This gift has already been claimed');

    const claimedGift = { ...gift, status: 'claimed', claimed_by_user_id: claimantPrivyUserId };
    return this.purchaseGiftTickets(claimedGift, claimantPrivyUserId);
  }

  /**
   * Shared by claimGift's fresh-claim and retry paths — the actual wallet-gen + fund + buy.
   * Ordered so the one step that moves real money (topUpFromFeeWallet, admin_treasury only) runs
   * last, right before the DB insert that records where it went — everything that can fail more
   * routinely (draw cutoff, fetching the claimant's wallet from Privy) happens first, while
   * failure is still free.
   *
   * admin_treasury: generates a fresh burner and funds it from Loofta's fee wallet right here.
   * sender_paid: reuses the burner the sender already funded back at initiateGiftedPurchase (see
   * that method) — no additional funding needed, just a companion wallet to buy into.
   */
  private async purchaseGiftTickets(gift: any, claimantPrivyUserId: string): Promise<{ ticketId: string; numTickets: number }> {
    try {
      await this.assertNotInDrawCutoff();
      const userSolanaAddress = await this.usersService.getSolanaWalletAddress(claimantPrivyUserId);

      const companionPrivKey = generatePrivateKey();
      const companionAddress = await this.rhinestone.getCompanionAddress(companionPrivKey);
      const companionKeyEnc = this.enc.encrypt(Buffer.from(companionPrivKey.slice(2), 'hex'), companionAddress);

      const numTickets = gift.num_tickets as number;
      const costUsdc = numTickets * TICKET_PRICE_USDC;
      const costUnits = Math.round(costUsdc * 1_000_000);

      let burnerAddress: string;
      let burnerKeyEnc: string;
      let senderTxHash: string;
      if (gift.funding_mode === 'sender_paid') {
        if (!gift.burner_sol_address || !gift.burner_sol_key_enc || !gift.sender_tx_hash) {
          throw new Error(`Gift ${gift.id}: sender_paid gift missing funded burner info`);
        }
        burnerAddress = gift.burner_sol_address;
        burnerKeyEnc = gift.burner_sol_key_enc;
        senderTxHash = gift.sender_tx_hash;
      } else {
        const burnerKeypair = Keypair.generate();
        burnerAddress = burnerKeypair.publicKey.toBase58();
        burnerKeyEnc = this.enc.encrypt(Buffer.from(burnerKeypair.secretKey), burnerAddress);
        senderTxHash = await this.topUpFromFeeWallet(burnerAddress, BigInt(costUnits));
      }

      const db = this.supabase.getClient();
      const { data: ticket, error } = await db
        .from('lottery_tickets')
        .insert({
          user_id: claimantPrivyUserId,
          user_solana_address: userSolanaAddress,
          companion_address: companionAddress,
          companion_key_enc: companionKeyEnc,
          burner_sol_address: burnerAddress,
          burner_sol_key_enc: burnerKeyEnc,
          num_tickets: numTickets,
          cost_usdc: costUsdc,
          status: 'sent',
          sender_tx_hash: senderTxHash,
          is_gift: true,
        })
        .select('id')
        .single();
      if (error || !ticket) throw new Error(`Failed to create gift lottery ticket: ${error?.message}`);

      await db.from('lottery_gifts').update({ resulting_ticket_id: ticket.id }).eq('id', gift.id);
      this.logger.log(`Gift ${gift.id}: claimed by ${claimantPrivyUserId}, ticket ${ticket.id} funded (${numTickets} tickets, sig=${senderTxHash})`);

      // Don't wait for the next processSentTickets cron tick (up to 5s away) — the burner is
      // already known-funded (just topped up, or funded by the sender earlier), so start the
      // bridge right now. Fire-and-forget: tryStartBridge does its own atomic claim against the
      // DB row, so this can't race the cron picking up the same ticket a moment later.
      this.tryStartBridge({
        id: ticket.id,
        status: 'sent',
        fee_tx_hash: null,
        is_gift: true,
        burner_sol_address: burnerAddress,
        burner_sol_key_enc: burnerKeyEnc,
        cost_usdc: costUsdc,
        companion_address: companionAddress,
      }).catch(e => this.logger.warn(`purchaseGiftTickets ${gift.id}: immediate tryStartBridge failed, cron will retry: ${e.message}`));

      return { ticketId: ticket.id, numTickets };
    } catch (e: any) {
      this.logger.error(`purchaseGiftTickets ${gift.id}: ${e.message}`);
      // Deliberately left as status='claimed' (not 'failed') with no resulting_ticket_id — this
      // is exactly the state claimGift's idempotent-retry branch looks for, so the same claimant
      // calling claim again will retry the purchase without re-verifying identity.
      await this.supabase.getClient()
        .from('lottery_gifts')
        .update({ failure_reason: e.message })
        .eq('id', gift.id);
      throw new BadRequestException('Something went wrong claiming your gift — please try again in a moment.');
    }
  }

  /**
   * Verifies ON-CHAIN that `txHash` is a confirmed transaction that credited the fee wallet
   * with at least `expectedUsdc` USDC. NEVER trust the client-supplied hash: a recorded-but-
   * unpaid fee becomes a refund candidate — i.e. a forged hash would let an attacker drain the
   * fee wallet through the refund cron. Retries because the frontend posts the hash immediately
   * after sending, often before the tx reaches 'confirmed'.
   */
  private async verifyFeePaymentOnChain(txHash: string, expectedUsdc: number, retries = 5): Promise<void> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    const feeWallet = Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey)).publicKey.toBase58();
    const conn = await this.getSolanaConnection();
    const usdcMint = USDC_MINT.toBase58();

    for (let attempt = 0; ; attempt++) {
      const tx = await conn.getTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx) {
        if (tx.meta?.err) throw new BadRequestException('Fee transaction failed on-chain');
        const pre = tx.meta?.preTokenBalances?.find(b => b.owner === feeWallet && b.mint === usdcMint);
        const post = tx.meta?.postTokenBalances?.find(b => b.owner === feeWallet && b.mint === usdcMint);
        const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
        const expectedUnits = BigInt(Math.round(expectedUsdc * 1_000_000));
        if (received < expectedUnits) {
          throw new BadRequestException(`Fee transaction paid ${received} units, expected ${expectedUnits}`);
        }
        return;
      }
      if (attempt >= retries) throw new BadRequestException('Fee transaction not found on-chain — wait a few seconds and retry');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  /** Records that the upfront fee-collection tx confirmed, before the MagicBlock tx is signed. */
  async confirmFeeCollection(opts: { ticketId: string; userId: string; feeTxHash: string }): Promise<void> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('cost_usdc, fee_tx_hash')
      .eq('id', opts.ticketId)
      .eq('user_id', opts.userId)
      .single();
    if (!ticket) throw new BadRequestException('Ticket not found');
    if (ticket.fee_tx_hash === opts.feeTxHash) return; // idempotent retry
    if (ticket.fee_tx_hash) throw new BadRequestException('Fee already recorded for this ticket');

    const feeUsdc = looftaTicketFee(ticket.cost_usdc);
    await this.verifyFeePaymentOnChain(opts.feeTxHash, feeUsdc);

    // A unique index on fee_tx_hash backstops this in the DB — one paid tx can't be attached
    // to a second ticket even under concurrent requests.
    const { error } = await db
      .from('lottery_tickets')
      .update({ fee_amount_usdc: feeUsdc, fee_tx_hash: opts.feeTxHash, updated_at: new Date().toISOString() })
      .eq('id', opts.ticketId)
      .eq('user_id', opts.userId);
    if (error) throw new Error(`confirmFeeCollection failed: ${error.message}`);
    this.logger.log(`Ticket ${opts.ticketId}: fee collected & verified on-chain, tx=${opts.feeTxHash}`);
  }

  async confirmSend(opts: { ticketId: string; userId: string; senderTxHash: string }): Promise<void> {
    const db = this.supabase.getClient();
    const { error } = await db
      .from('lottery_tickets')
      .update({ status: 'sent', sender_tx_hash: opts.senderTxHash, updated_at: new Date().toISOString() })
      .eq('id', opts.ticketId)
      .eq('user_id', opts.userId);
    if (error) throw new Error(`confirmSend failed: ${error.message}`);
    this.logger.log(`Ticket ${opts.ticketId} marked sent, tx: ${opts.senderTxHash}`);
  }

  /** Refunds the upfront fee back to the user, if one was collected and not already refunded. */
  private async refundFeeIfNeeded(ticket: any): Promise<void> {
    if (!ticket.fee_tx_hash || ticket.fee_refunded_at) return;
    if (!ticket.user_solana_address) {
      this.logger.warn(`Ticket ${ticket.id}: cannot refund fee — no user_solana_address on record`);
      return;
    }
    const feeUsdc = ticket.fee_amount_usdc ?? looftaTicketFee(ticket.cost_usdc);

    // Defense in depth: re-verify the original fee payment on-chain before sending real money
    // back. If the recorded hash never actually paid us (any bug or bypass upstream), mark it
    // invalid so the cron stops retrying, and refund nothing.
    try {
      await this.verifyFeePaymentOnChain(ticket.fee_tx_hash, feeUsdc, 0);
    } catch (e: any) {
      this.logger.error(`Ticket ${ticket.id}: REFUND BLOCKED — recorded fee tx failed on-chain verification (${e.message})`);
      await this.supabase.getClient()
        .from('lottery_tickets')
        .update({ fee_refunded_at: new Date().toISOString(), fee_refund_tx_hash: 'INVALID_FEE_TX' })
        .eq('id', ticket.id);
      return;
    }

    const feeUnits = BigInt(Math.round(feeUsdc * 1_000_000));
    const sig = await this.topUpFromFeeWallet(ticket.user_solana_address, feeUnits);
    await this.supabase.getClient()
      .from('lottery_tickets')
      .update({ fee_refunded_at: new Date().toISOString(), fee_refund_tx_hash: sig })
      .eq('id', ticket.id);
    this.logger.log(`Ticket ${ticket.id}: refunded ${(Number(feeUnits) / 1_000_000).toFixed(6)} USDC fee, sig=${sig}`);
  }

  /**
   * Cron: give back the upfront fee for any purchase that didn't go through — covers every
   * failure path in one place (rather than threading a refund call into each individual
   * `status: 'failed'` site) plus two cases nothing else marks as failed:
   *  - abandoned after fee payment but before the MagicBlock tx was ever confirmed (user closed
   *    the app / rejected the second signature)
   *  - MagicBlock silently never delivers to the burner (no on-chain revert to react to)
   */
  private refundRunning = false;

  async refundOutstandingFees(): Promise<void> {
    // Overlap guard: refunds move real money — two concurrent runs would both read
    // fee_refunded_at=null and both pay out.
    if (this.refundRunning) return;
    this.refundRunning = true;
    try {
      await this.refundOutstandingFeesInner();
    } finally {
      this.refundRunning = false;
    }
  }

  private async refundOutstandingFeesInner(): Promise<void> {
    const db = this.supabase.getClient();
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();

    const [{ data: failed }, { data: abandoned }, { data: neverArrived }] = await Promise.all([
      db.from('lottery_tickets').select('*')
        .eq('status', 'failed').not('fee_tx_hash', 'is', null).is('fee_refunded_at', null).limit(20),
      db.from('lottery_tickets').select('*')
        .eq('status', 'pending_send').not('fee_tx_hash', 'is', null).is('sender_tx_hash', null)
        .is('fee_refunded_at', null).lt('created_at', tenMinAgo).limit(20),
      db.from('lottery_tickets').select('*')
        .eq('status', 'sent').not('fee_tx_hash', 'is', null)
        .is('fee_refunded_at', null).lt('created_at', twentyMinAgo).limit(20),
    ]);

    for (const ticket of [...(failed ?? []), ...(abandoned ?? []), ...(neverArrived ?? [])]) {
      try {
        await this.refundFeeIfNeeded(ticket);
        if (ticket.status !== 'failed') {
          await db.from('lottery_tickets').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
        }
      } catch (e: any) {
        this.logger.error(`refundOutstandingFees ${ticket.id}: ${e.message}`);
      }
    }
  }

  /**
   * Cron: a bridge that's sat in 'bridging' for BRIDGE_STALL_TIMEOUT_MS with no fill is treated
   * as abandoned by the bridge's solver network — see the 83cb2a7b incident (Eco Protocol quoted
   * 7s execution, delivered nothing after 20+ min, zero destination-chain activity the whole
   * time). Rather than leave the user's money in limbo indefinitely, Loofta fronts the ticket
   * cost back to the user's own Solana balance immediately and marks the ticket for manual
   * recovery — the original bridged funds are chased separately (this does NOT touch them).
   */
  private refundingStalled = false;

  async refundStalledBridges(): Promise<void> {
    if (this.refundingStalled) return;
    this.refundingStalled = true;
    try {
      const db = this.supabase.getClient();
      const staleBefore = new Date(Date.now() - BRIDGE_STALL_TIMEOUT_MS).toISOString();

      // Newly-stalled: still 'bridging', past the timeout, never claimed.
      const { data: newlyStalled } = await db
        .from('lottery_tickets')
        .select('*')
        .eq('status', 'bridging')
        .not('lifi_buy_tx_hash', 'is', null)
        .is('stall_refunded_at', null)
        .lt('updated_at', staleBefore)
        .limit(10);

      for (const ticket of newlyStalled ?? []) {
        await this.claimStalledTicket(ticket).catch(e =>
          this.logger.error(`refundStalledBridges (claim) ${ticket.id}: ${e.message}`),
        );
      }

      // Previously claimed but the payout itself never completed (crash/network error mid-send)
      // — retry just the payment, not the claim (status is already 'failed', so this can never
      // race processBridgingTickets, which only touches 'bridging'/'buying' tickets).
      const { data: pendingPayout } = await db
        .from('lottery_tickets')
        .select('*')
        .eq('bridge_status', 'STALL_REFUND_PENDING')
        .limit(10);

      for (const ticket of pendingPayout ?? []) {
        await this.payStalledRefund(ticket).catch(e =>
          this.logger.error(`refundStalledBridges (payout retry) ${ticket.id}: ${e.message}`),
        );
      }
    } finally {
      this.refundingStalled = false;
    }
  }

  private async claimStalledTicket(ticket: any): Promise<void> {
    // Don't even attempt the claim if the bridge actually completed in this same window —
    // saves a wasted conditional write, though the update guard below is what actually matters.
    const lifiStatus = await this.lifi.getStatus(ticket.lifi_buy_tx_hash, ticket.lifi_buy_tool, 'sol_to_base');
    if (lifiStatus === 'DONE') return;

    // Atomic claim: races against processBridgingTickets, which can flip this same ticket to
    // 'buying' the instant Li.Fi reports DONE. Only one side's conditional update can land on a
    // still-'bridging' row; the loser (0 rows affected) sends nothing and does nothing further.
    const db = this.supabase.getClient();
    const { data: claimed, error: claimErr } = await db
      .from('lottery_tickets')
      .update({ status: 'failed', bridge_status: 'STALL_REFUND_PENDING', updated_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('status', 'bridging')
      .select('id');
    if (claimErr) throw new Error(`stall-refund claim failed: ${claimErr.message}`);
    if (!claimed?.length) {
      this.logger.log(`Ticket ${ticket.id}: bridge completed/claimed elsewhere just before stall-refund — skipping`);
      return;
    }

    await this.payStalledRefund(ticket);
  }

  private async payStalledRefund(ticket: any): Promise<void> {
    if (!ticket.user_solana_address) {
      this.logger.error(`Ticket ${ticket.id}: bridge stalled but no user_solana_address on record — cannot auto-refund, needs manual handling`);
      return;
    }

    const costUnits = BigInt(Math.round(ticket.cost_usdc * 1_000_000));
    const sig = await this.topUpFromFeeWallet(ticket.user_solana_address, costUnits);

    const db = this.supabase.getClient();
    await db.from('lottery_tickets').update({
      bridge_status: 'STALLED_REFUNDED',
      stall_refunded_at: new Date().toISOString(),
      stall_refund_tx_hash: sig,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    this.logger.error(
      `Ticket ${ticket.id}: bridge stalled >${BRIDGE_STALL_TIMEOUT_MS / 60_000}min with no fill — ` +
      `auto-refunded ${ticket.cost_usdc} USDC to ${ticket.user_solana_address}, sig=${sig}. ` +
      `Original funds at ${ticket.lifi_buy_tx_hash} still need manual recovery from the bridge provider.`,
    );
  }

  // ─── Public (non-private) purchase ────────────────────────────────────────

  async initiatePublicPurchase(opts: {
    userId: string;
    numTickets: number;
  }): Promise<InitiatePublicPurchaseResult> {
    const { userId, numTickets } = opts;
    if (numTickets < 1 || numTickets > 500) throw new BadRequestException('1–500 tickets per public purchase');
    await this.assertNotInDrawCutoff();

    // Fresh companion wallet on Base
    const companionPrivKey = generatePrivateKey();
    const companionAccount = privateKeyToAccount(companionPrivKey);
    const companionAddress = companionAccount.address;
    const companionKeyEnc = this.enc.encrypt(Buffer.from(companionPrivKey.slice(2), 'hex'), companionAddress);

    const costUsdc = numTickets * TICKET_PRICE_USDC;

    // Idempotency: return existing pending ticket if user already has one with same count (within 24h)
    const db = this.supabase.getClient();
    const { data: existing } = await db
      .from('lottery_tickets')
      .select('id, bridge_deposit_address, cost_usdc')
      .eq('user_id', userId)
      .eq('status', 'pending_send')
      .eq('num_tickets', numTickets)
      .is('burner_sol_address', null)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.bridge_deposit_address) {
      this.logger.log(`Public ticket: returning existing pending ticket ${existing.id} for user ${userId}`);
      return { ticketId: existing.id, depositAddress: existing.bridge_deposit_address, amountUsdc: existing.cost_usdc };
    }

    // Bridge SOL USDC → Base ETH directly to companion.
    // ETH covers gas for Uniswap swap + ticket purchase. 15% buffer over ticket cost.
    const BRIDGE_FEE_BUFFER = 0.15;
    const amountToSend = parseFloat((costUsdc + BRIDGE_FEE_BUFFER).toFixed(6));

    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: NEAR_ASSET_SOL_USDC, chain: NEAR_ASSET_SOL_USDC_CHAIN, symbol: 'USDC', decimals: 6 },
      toToken: { tokenId: NEAR_ASSET_BASE_ETH, chain: NEAR_ASSET_BASE_ETH_CHAIN, symbol: 'ETH', decimals: 18 },
      amountIn: amountToSend.toString(),
      recipient: companionAddress,
      deadlineMs: 24 * 60 * 60 * 1000,
    });

    if (!quote.depositAddress) throw new BadRequestException('Bridge quote unavailable — try again');

    const { data: ticket, error } = await db
      .from('lottery_tickets')
      .insert({
        user_id: userId,
        companion_address: companionAddress,
        companion_key_enc: companionKeyEnc,
        // burner fields intentionally null — signals public route
        num_tickets: numTickets,
        cost_usdc: costUsdc,
        status: 'pending_send',
        bridge_deposit_address: quote.depositAddress,
        bridge_memo: quote.memo ?? null,
        bridge_quote_id: quote.quoteId ?? null,
        bridge_status: 'pending',
        bridge_expires_at: quote.deadline ?? null,
      })
      .select('id')
      .single();

    if (error || !ticket) throw new Error(`Failed to create public ticket: ${error?.message}`);

    this.logger.log(`Public ticket ${ticket.id}: send ${amountToSend} USDC to ${quote.depositAddress}`);
    return { ticketId: ticket.id, depositAddress: quote.depositAddress, amountUsdc: amountToSend };
  }

  // ─── Cron processing ───────────────────────────────────────────────────────

  /** Process all tickets in 'sent' status: check if burner has USDC, start bridge */
  // Overlap guards: with fast cron intervals a slow run (RPC hiccup, many tickets) can outlive
  // its interval — a second concurrent run would see the same 'sent' rows and double-bridge.
  private processingSent = false;
  private processingBridging = false;

  async processSentTickets(): Promise<void> {
    if (this.processingSent) return;
    this.processingSent = true;
    try {
      const db = this.supabase.getClient();
      const { data: tickets } = await db
        .from('lottery_tickets')
        .select('*')
        .eq('status', 'sent')
        .not('burner_sol_address', 'is', null)  // public tickets skip this cron
        .order('created_at', { ascending: true })
        .limit(20);

      for (const ticket of tickets ?? []) {
        await this.tryStartBridge(ticket).catch(e =>
          this.logger.warn(`processSent ${ticket.id}: ${e.message}`),
        );
      }

      // Closed-tab resilience: a user can sign the MagicBlock tx but close the window before
      // buy-confirm reaches us — the ticket then sits in pending_send and the refund cron would
      // wrongly refund a purchase whose money is about to land. The burner balance is the
      // ground truth: any USDC there means the transfer really was sent, so promote to 'sent'.
      // Normal purchases sign a fee tx before the MagicBlock tx, so fee_tx_hash being set proves
      // they got that far; gift purchases (is_gift) have no separate fee tx at all (MagicBlock
      // collects it inline), so they're eligible here purely on age + a funded burner instead.
      const { data: pending } = await db
        .from('lottery_tickets')
        .select('*')
        .eq('status', 'pending_send')
        .not('burner_sol_address', 'is', null)
        .or('fee_tx_hash.not.is.null,is_gift.eq.true')
        .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
        .limit(20);

      for (const ticket of pending ?? []) {
        const balance = await this.getBurnerUsdcBalance(ticket.burner_sol_address);
        if (balance > 0n) {
          await db.from('lottery_tickets').update({
            status: 'sent',
            sender_tx_hash: 'detected-onchain',
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id).eq('status', 'pending_send');
          this.logger.log(`Ticket ${ticket.id}: burner funded while still pending_send (user likely closed the tab) — promoted to sent`);
        }
      }
    } finally {
      this.processingSent = false;
    }
  }

  private async tryStartBridge(ticket: any): Promise<void> {
    // No verified fee, no service — UNLESS this is an admin-issued gift (is_gift), where Loofta
    // never charges a fee in the first place, so there's nothing to verify. Without this gate a
    // client that skips the fee tx (calling buy-confirm directly) would still get bridging +
    // ticket purchase for free.
    if (!ticket.fee_tx_hash && !ticket.is_gift) {
      this.logger.warn(`Ticket ${ticket.id}: no fee recorded — not bridging (funds stay rescuable from the burner)`);
      return;
    }
    const burnerBalance = await this.getBurnerUsdcBalance(ticket.burner_sol_address);
    const costUnits = BigInt(Math.round(ticket.cost_usdc * 1_000_000));

    // MagicBlock splits mainnet transfers into several parts that land separately across the
    // delay window — wait for the full costUsdc to arrive before touching the burner.
    if (burnerBalance < costUnits) {
      this.logger.log(`Ticket ${ticket.id}: burner not yet funded (${burnerBalance} < ${costUnits})`);
      return;
    }

    // Atomic claim: two overlapping cron ticks (or two backend replicas) can both select this
    // same 'sent' ticket before either finishes bridging it — without this, both would build and
    // broadcast their own Li.Fi transaction from the same burner. Only one write wins the
    // conditional update; the loser sees 0 rows affected and bails before touching the chain.
    // A 2-minute TTL lets a genuinely stuck/crashed claim become retryable again.
    //
    // Two sequential single-condition updates instead of one `.or(a,b)` update — this project's
    // PostgREST throws a spurious "column does not exist" specifically for PATCH requests whose
    // filter includes an `or=(...)` referencing this column (a GET with the identical `.or()`
    // filter works fine, and a PATCH without `.or()` works fine — only PATCH + `.or()` fails).
    const claimDb = this.supabase.getClient();
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    let claimedRows: { id: string }[] | null = null;
    {
      const { data, error } = await claimDb
        .from('lottery_tickets')
        .update({ bridge_claimed_at: new Date().toISOString() })
        .eq('id', ticket.id)
        .eq('status', 'sent')
        .is('bridge_claimed_at', null)
        .select('id');
      if (error) throw new Error(`bridge claim failed: ${error.message}`);
      claimedRows = data;
    }
    if (!claimedRows?.length) {
      const { data, error } = await claimDb
        .from('lottery_tickets')
        .update({ bridge_claimed_at: new Date().toISOString() })
        .eq('id', ticket.id)
        .eq('status', 'sent')
        .lt('bridge_claimed_at', staleBefore)
        .select('id');
      if (error) throw new Error(`bridge claim (stale-retry) failed: ${error.message}`);
      claimedRows = data;
    }
    if (!claimedRows?.length) {
      this.logger.log(`Ticket ${ticket.id}: bridge already claimed by a concurrent run — skipping`);
      return;
    }

    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');

    const burnerKey = this.decryptKey(ticket.burner_sol_key_enc, ticket.burner_sol_address);

    // Li.Fi: Solana USDC (burner) → Base USDC (companion). The burner only holds costUsdc — Li.Fi
    // always takes some cut, so bridging that exact amount would land short. Top up from the fee
    // wallet (funded by the fee collected upfront on every purchase, see initiatePurchase) to
    // cover the gap, then bridge the corrected amount so the companion still nets exactly
    // costUsdc — this is an internal operational transfer, not the user's payment, so it doesn't
    // need MagicBlock privacy.
    // Bridge the burner's full balance (costUnits normally; also reuses any top-up from an
    // aborted earlier attempt instead of stranding it).
    let bridgeAmountUnits = Number(burnerBalance);
    let quote = await this.lifi.getSolToBaseQuote({
      fromAddress: ticket.burner_sol_address,
      toAddress: ticket.companion_address,
      amountUsdc: bridgeAmountUnits / 1_000_000,
    });

    // Li.Fi's cut has a proportional component, so covering the exact quoted gap converges
    // slightly short on the re-quote (real failure: companion landed at 0.999994, buy needs
    // 1.000000). Pad each top-up and RE-CHECK the new quote until toAmountMin clears costUnits;
    // the padding lands as recoverable dust on the companion.
    const TOPUP_PAD_UNITS = 2_000n; // $0.002
    let toAmountMinUnits = BigInt(quote.estimate.toAmountMin);
    let attempts = 0;
    while (toAmountMinUnits < costUnits) {
      if (++attempts > 3) throw new Error(`bridge quote still short after ${attempts - 1} top-ups (toAmountMin=${toAmountMinUnits} < ${costUnits}) — will retry next cron`);
      const shortfallUnits = costUnits - toAmountMinUnits + TOPUP_PAD_UNITS;
      await this.topUpFromFeeWallet(ticket.burner_sol_address, shortfallUnits);
      bridgeAmountUnits += Number(shortfallUnits);
      quote = await this.lifi.getSolToBaseQuote({
        fromAddress: ticket.burner_sol_address,
        toAddress: ticket.companion_address,
        amountUsdc: bridgeAmountUnits / 1_000_000,
      });
      toAmountMinUnits = BigInt(quote.estimate.toAmountMin);
      this.logger.log(`Ticket ${ticket.id}: topped up burner by ${(Number(shortfallUnits) / 1_000_000).toFixed(6)} USDC to cover Li.Fi's cut (new toAmountMin=${toAmountMinUnits})`);
    }

    const lifiTxHash = await this.lifi.executeSolanaQuote({
      burnerSecretKey: burnerKey,
      quote,
      feePayerSecretKey: feePayerKey,
    });

    const db = this.supabase.getClient();
    await db.from('lottery_tickets').update({
      status: 'bridging',
      bridge_deposit_address: lifiTxHash, // repurpose: stores Li.Fi tx hash for SOL→Base
      bridge_status: 'pending',
      lifi_buy_tx_hash: lifiTxHash,
      lifi_buy_tool: quote.tool,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    this.logger.log(`Ticket ${ticket.id}: Li.Fi bridge ${quote.tool} started, tx=${lifiTxHash}`);
  }

  /** Process all tickets in 'bridging' or stuck 'buying' status: check bridge + buy */
  async processBridgingTickets(): Promise<void> {
    if (this.processingBridging) return;
    this.processingBridging = true;
    try {
      const db = this.supabase.getClient();
      // Also retry 'buying' tickets with no NFTs yet (e.g. Rhinestone failed last run)
      const { data: tickets } = await db
        .from('lottery_tickets')
        .select('*')
        .or(`status.eq.bridging,status.eq.buying,and(status.eq.pending_send,burner_sol_address.is.null,bridge_deposit_address.not.is.null)`)
        .order('created_at', { ascending: true })
        .limit(20);

      for (const ticket of tickets ?? []) {
        await this.tryBuyTickets(ticket).catch(e =>
          this.logger.warn(`processBridging ${ticket.id}: ${e.message}`),
        );
      }
    } finally {
      this.processingBridging = false;
    }
  }

  private async tryBuyTickets(ticket: any): Promise<void> {
    const db = this.supabase.getClient();

    // If already in 'buying' (retry after Rhinestone failure) skip bridge status check
    if (ticket.status !== 'buying') {
      if (ticket.lifi_buy_tx_hash) {
        // New flow: Li.Fi bridge (SOL → Base)
        const lifiStatus = await this.lifi.getStatus(ticket.lifi_buy_tx_hash, ticket.lifi_buy_tool, 'sol_to_base');
        this.logger.log(`Ticket ${ticket.id}: Li.Fi buy status=${lifiStatus} tx=${ticket.lifi_buy_tx_hash}`);

        if (lifiStatus === 'FAILED') {
          await db.from('lottery_tickets').update({
            status: 'failed',
            bridge_status: 'FAILED',
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          return;
        }
        if (lifiStatus !== 'DONE') return; // still in flight

        // Conditional on status='bridging': closes the race against refundStalledBridges, which
        // can independently decide the same ticket is stalled and refund it around the same
        // moment Li.Fi actually delivers. Whichever update lands first on the still-'bridging'
        // row wins; the other affects 0 rows and backs off instead of double-processing money.
        const { data: claimed } = await db.from('lottery_tickets').update({
          bridge_status: 'DONE',
          status: 'buying',
          updated_at: new Date().toISOString(),
        }).eq('id', ticket.id).eq('status', 'bridging').select('id');
        if (!claimed?.length) {
          this.logger.warn(`Ticket ${ticket.id}: Li.Fi delivered but ticket was concurrently claimed elsewhere (e.g. stall-refund) — skipping buy`);
          return;
        }
        this.logger.log(`Ticket ${ticket.id}: Li.Fi buy bridge DONE → buying`);
      } else {
        // Legacy flow: NEAR Intents bridge
        if (!ticket.bridge_deposit_address) {
          this.logger.warn(`Ticket ${ticket.id}: no deposit address to poll`);
          return;
        }

        // Fast path: check Solana RPC directly — much faster than NEAR Intents polling
        if (ticket.status === 'pending_send') {
          const solBalance = await this.checkSolanaUsdcDeposit(ticket.bridge_deposit_address).catch(() => 0);
          if (solBalance > 0) {
            this.logger.log(`Ticket ${ticket.id}: Solana RPC detected ${solBalance} USDC at deposit — fast transition to bridging`);
            await db.from('lottery_tickets').update({
              status: 'bridging',
              bridge_status: 'DEPOSITED',
              updated_at: new Date().toISOString(),
            }).eq('id', ticket.id);
            ticket.status = 'bridging';
          }
        }

        const nearStatus = await this.nearIntents.getExecutionStatus(ticket.bridge_deposit_address);
        const s = String((nearStatus as any)?.status ?? (nearStatus as any)?.Status ?? '').toUpperCase();
        this.logger.log(`Ticket ${ticket.id}: NEAR Intents status = ${s} | deposit = ${ticket.bridge_deposit_address}`);

        const isDone = ['SUCCESS', 'COMPLETED'].includes(s);
        const isFailed = ['REFUNDED', 'EXPIRED', 'FAILED', 'CANCELLED', 'INCOMPLETE_DEPOSIT'].includes(s);
        const isInFlight = ['DEPOSITED', 'PROCESSING', 'SWAPPED'].includes(s);

        if (isFailed) {
          await db.from('lottery_tickets').update({
            status: 'failed', bridge_status: s, updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.warn(`Ticket ${ticket.id}: bridge ${s} — marked failed`);
          return;
        }

        if (s === 'PENDING_DEPOSIT' && ticket.bridge_expires_at && new Date(ticket.bridge_expires_at) < new Date()) {
          await db.from('lottery_tickets').update({
            status: 'failed', bridge_status: 'EXPIRED', updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.warn(`Ticket ${ticket.id}: deposit window expired — marked failed`);
          return;
        }

        if (!isDone) {
          if (ticket.status === 'pending_send' && isInFlight) {
            await db.from('lottery_tickets').update({
              status: 'bridging', bridge_status: s, updated_at: new Date().toISOString(),
            }).eq('id', ticket.id);
            this.logger.log(`Ticket ${ticket.id}: deposit received (${s}), moved to bridging`);
          }
          return;
        }

        await db.from('lottery_tickets').update({ bridge_status: s, status: 'buying', updated_at: new Date().toISOString() }).eq('id', ticket.id);
        this.logger.log(`Ticket ${ticket.id}: NEAR Intents complete (${s}), moving to buying`);
      }
    }

    const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
    const companionPrivHex = `0x${companionKey.toString('hex')}`;

    // Public flow (no burner): bridge delivered ETH, swap → buy → sweep
    if (!ticket.burner_sol_address) {
      const { createPublicClient, http, erc20Abi: erc20 } = await import('viem');
      const { base } = await import('viem/chains');
      const rpc = this.config.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
      const publicClient = createPublicClient({ chain: base, transport: http(rpc) });

      const [ethBalance, existingUsdc] = await Promise.all([
        publicClient.getBalance({ address: ticket.companion_address as Address }),
        publicClient.readContract({
          address: MEGAPOT_USDC,
          abi: erc20,
          functionName: 'balanceOf',
          args: [ticket.companion_address as Address],
        }) as Promise<bigint>,
      ]);

      const usdcNeeded = BigInt(ticket.num_tickets) * 1_000_000n;
      const hasEnoughUsdc = existingUsdc >= usdcNeeded;

      this.logger.log(`Ticket ${ticket.id}: companion=${ticket.companion_address} ETH=${ethBalance} wei USDC=${existingUsdc} (need ${usdcNeeded}) https://basescan.org/address/${ticket.companion_address}`);

      // Need ETH if we still have to do the swap; if USDC is already there just need gas
      if (!hasEnoughUsdc && ethBalance <= ETH_GAS_RESERVE * 2n) {
        this.logger.log(`Ticket ${ticket.id}: ETH not yet arrived (need >${ETH_GAS_RESERVE * 2n} wei), waiting...`);
        return;
      }

      try {
        await this.buyWithEthCompanion({ ticket, companionPrivHex });
      } catch (err: any) {
        await db.from('lottery_tickets').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
        this.logger.error(`Ticket ${ticket.id}: public buy failed: ${err.message}`);
      }
      return;
    }

    // Private flow: companion smart account has USDC from bridge. Rhinestone sponsors gas.
    const usdcBalance = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => null);
    this.logger.log(`Ticket ${ticket.id}: private companion ${ticket.companion_address} USDC=${usdcBalance ?? '?'}`);

    const usdcNeeded = ticket.num_tickets * TICKET_PRICE_USDC;
    if (usdcBalance === null || usdcBalance < usdcNeeded * 0.9) {
      this.logger.warn(`Ticket ${ticket.id}: companion has ${usdcBalance} USDC, need ${usdcNeeded} — waiting for bridge to settle`);
      return;
    }
    // The Megapot buy needs the EXACT ticket cost — attempting with even 1 unit less fails the
    // simulation. The padded bridge top-up loop (tryStartBridge) should prevent shortfalls, but
    // if one still lands, stay in 'buying' and log loudly: it resolves by manually sending the
    // missing USDC to the companion on Base, then the next cron completes the buy.
    if (usdcBalance < usdcNeeded) {
      this.logger.warn(`Ticket ${ticket.id}: companion short ${(usdcNeeded - usdcBalance).toFixed(6)} USDC (has ${usdcBalance}, needs ${usdcNeeded}) — send the difference to ${ticket.companion_address} on Base to unblock`);
      return;
    }

    try {
      await this.rhinestone.buyMegapotTickets({
        companionPrivateKey: companionPrivHex as `0x${string}`,
        numTickets: ticket.num_tickets,
        recipient: ticket.companion_address as Address,
        sourceId: this.megapot.getSourceId(),
        referrers: this.megapot.getReferrers(),
        splits: this.megapot.getSplits(),
      });

      let roundId: string | null = null, drawTime: string | null = null;
      try { const round = await this.megapot.getActiveRound(); roundId = round?.id ?? null; drawTime = round?.drawTime ?? null; } catch {}

      await db.from('lottery_tickets').update({
        status: 'active', round_id: roundId, draw_time: drawTime, updated_at: new Date().toISOString(),
      }).eq('id', ticket.id);
      this.logger.log(`Ticket ${ticket.id}: active! ${ticket.num_tickets} private ticket(s) bought`);

      // Non-blocking: fetch actual ball numbers from Megapot NFT metadata
      this.megapot.getTicketNumbersFromNft(ticket.companion_address as Address, roundId ?? undefined)
        .then(async ({ tokenIds, ticketNumbers }) => {
          if (ticketNumbers.length === 0) {
            this.logger.warn(`Ticket ${ticket.id}: no NFT numbers yet for companion ${ticket.companion_address}`);
            return;
          }
          await db.from('lottery_tickets').update({
            ticket_numbers: ticketNumbers,
            ticket_nft_ids: tokenIds,
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: stored ${ticketNumbers.length} NFT ball numbers`);
        })
        .catch(e => this.logger.warn(`Ticket ${ticket.id}: NFT number fetch: ${e.message}`));

      // Sweep any leftover USDC (fee buffer remainder) back to Loofta wallet
      const leftover = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0);
      if (leftover >= 0.001) {
        this.logger.log(`Ticket ${ticket.id}: sweeping leftover ${leftover} USDC from companion → Loofta`);
        await this.rhinestone.rescueUsdc({
          companionPrivateKey: companionPrivHex as `0x${string}`,
          rescueWallet: LOOFTA_WALLET,
          amountUsdc: leftover,
        }).catch(e => this.logger.warn(`Ticket ${ticket.id}: leftover sweep failed: ${e.message}`));
      }
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      // A balance shortfall is retryable (companion top-up next cron) — marking it failed
      // dead-ends a ticket whose funds already reached Base and triggers a fee refund.
      if (/insufficient token balance/i.test(msg)) {
        this.logger.warn(`Ticket ${ticket.id}: buy short on balance — staying in 'buying' to retry: ${msg}`);
        return;
      }
      await db.from('lottery_tickets').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
      this.logger.error(`Ticket ${ticket.id}: private buyTickets failed: ${msg}`);
    }
  }

  /** Backfill ball numbers for active tickets that don't have them yet (existing tickets). */
  async backfillTicketNumbers(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: tickets } = await db
      .from('lottery_tickets')
      .select('id, companion_address, round_id')
      .eq('status', 'active')
      .is('ticket_numbers', null)
      .not('companion_address', 'is', null)
      .limit(10);

    if (!tickets?.length) return;

    for (const ticket of tickets) {
      try {
        // Try API first (no RPC needed), fall back to on-chain scan
        const { ticketNumbers: apiNumbers } = await this.megapot.getTicketNumbersFromApi(
          ticket.companion_address as Address,
          ticket.round_id ?? undefined,
        );

        if (apiNumbers.length > 0) {
          await db.from('lottery_tickets').update({
            ticket_numbers: apiNumbers,
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Backfill: stored ${apiNumbers.length} numbers via API for ticket ${ticket.id}`);
          continue;
        }

        const { tokenIds, ticketNumbers } = await this.megapot.getTicketNumbersFromNft(
          ticket.companion_address as Address,
          ticket.round_id ?? undefined,
        );
        if (ticketNumbers.length > 0) {
          await db.from('lottery_tickets').update({
            ticket_numbers: ticketNumbers,
            ticket_nft_ids: tokenIds,
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Backfill: stored ${ticketNumbers.length} numbers on-chain for ticket ${ticket.id}`);
        }
      } catch (e: any) {
        this.logger.warn(`Backfill failed for ticket ${ticket.id}: ${e.message}`);
      }
    }
  }

  async syncTicketNumbers(ticketId: string, userId: string): Promise<{ ok: boolean; count: number }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('id, companion_address, round_id, status, ticket_numbers, ticket_nft_ids, num_tickets')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket?.companion_address) return { ok: false, count: 0 };

    // Return early only when ALL ticket numbers are stored; re-fetch if count < num_tickets
    const storedCount = Array.isArray(ticket.ticket_numbers) ? ticket.ticket_numbers.length : 0;
    if (storedCount > 0 && storedCount >= ticket.num_tickets) {
      return { ok: true, count: storedCount };
    }

    // Try Megapot API first (no RPC, fastest path)
    const { ticketNumbers: apiNumbers } = await this.megapot.getTicketNumbersFromApi(
      ticket.companion_address as Address,
      ticket.round_id ?? undefined,
    );

    if (apiNumbers.length > 0) {
      await db.from('lottery_tickets').update({
        ticket_numbers: apiNumbers,
        updated_at: new Date().toISOString(),
      }).eq('id', ticketId);
      this.logger.log(`syncTicketNumbers ${ticketId}: stored ${apiNumbers.length} numbers via API`);
      return { ok: true, count: apiNumbers.length };
    }

    // Fall back to on-chain NFT Transfer event scan (also retrieves NFT IDs for claimWinnings)
    const { tokenIds, ticketNumbers } = await this.megapot.getTicketNumbersFromNft(
      ticket.companion_address as Address,
      ticket.round_id ?? undefined,
    );

    this.logger.log(`syncTicketNumbers ${ticketId}: found ${ticketNumbers.length} NFT numbers on-chain, tokenIds=${tokenIds.slice(0, 3).join(',')}`);

    if (ticketNumbers.length > 0) {
      // Merge: if new scan has more tickets than stored, use the larger set
      const merged = ticketNumbers.length >= storedCount ? ticketNumbers : (ticket.ticket_numbers ?? ticketNumbers);
      const mergedIds = ticketNumbers.length >= storedCount ? tokenIds : (ticket.ticket_nft_ids ?? tokenIds);
      await db.from('lottery_tickets').update({
        ticket_numbers: merged,
        ticket_nft_ids: mergedIds,
        updated_at: new Date().toISOString(),
      }).eq('id', ticketId);
      this.logger.log(`syncTicketNumbers ${ticketId}: stored ${merged.length} numbers (was ${storedCount}, scan returned ${ticketNumbers.length})`);
    }

    return { ok: true, count: Math.max(ticketNumbers.length, storedCount) };
  }

  async rescueCompanionFunds(ticketId: string, userId: string): Promise<{ ok: boolean; rescued: boolean; amountUsdc: number; message: string }> {
    const RESCUE_WALLET = '0x50c236e3B93D3d69fe23F4D648A13901e6DdbC39' as const;
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found');

    const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
    const companionPrivHex = `0x${companionKey.toString('hex')}`;

    const usdcBalance = await this.getCompanionUsdcBalance(ticket.companion_address);

    this.logger.log(`Rescuing companion ${ticket.companion_address}: USDC=${usdcBalance}`);

    // Nothing on Base to move — do NOT mark the ticket 'failed'/'RESCUED', that would falsely
    // declare it resolved (and permanently block Retry) while the funds are actually still
    // elsewhere, e.g. mid-bridge on Solana or sitting in the burner. Leave status untouched so
    // the ticket stays actionable (Retry, or Rescue from Solana).
    if (usdcBalance <= 0) {
      return {
        ok: true,
        rescued: false,
        amountUsdc: 0,
        message: 'No funds found on Base — try "Rescue from Solana" instead, the money may still be on the burner or mid-bridge.',
      };
    }

    await this.rhinestone.rescueUsdc({
      companionPrivateKey: companionPrivHex as `0x${string}`,
      rescueWallet: RESCUE_WALLET,
      amountUsdc: usdcBalance,
    });
    this.logger.log(`Rescue USDC complete: ${usdcBalance} USDC → ${RESCUE_WALLET}`);

    await db.from('lottery_tickets').update({
      status: 'failed',
      bridge_status: 'RESCUED',
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    return { ok: true, rescued: true, amountUsdc: usdcBalance, message: `$${usdcBalance.toFixed(2)} USDC rescued and sent back to your Loofta balance.` };
  }

  async rescueBurnerFunds(
    ticketId: string,
    userId: string,
    destinationSolAddress: string,
  ): Promise<{ ok: boolean; message: string }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found');
    if (!ticket.burner_sol_address || !ticket.burner_sol_key_enc) {
      throw new BadRequestException('No Solana burner wallet for this ticket');
    }

    const burnerBalance = await this.getBurnerUsdcBalance(ticket.burner_sol_address);
    if (burnerBalance === 0n) {
      throw new BadRequestException(
        'Burner wallet has no USDC yet — MagicBlock delivery can take up to 2 min. Try again shortly.',
      );
    }

    const burnerKey = this.decryptKey(ticket.burner_sol_key_enc, ticket.burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);

    // Direct SPL transfer — no bridge, no MagicBlock, burner → user's Solana wallet
    const conn = await this.getSolanaConnection();
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new BadRequestException('Fee payer not configured');
    const bs58 = await import('bs58');
    const feePayerKeypair = Keypair.fromSecretKey(bs58.default.decode(feePayerKey));

    const allAccounts = await conn.getParsedTokenAccountsByOwner(
      burnerKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );
    const usdcMint = USDC_MINT.toBase58();
    const burnerTokenAccount = allAccounts.value.find(
      (a) => (a.account.data as any).parsed?.info?.mint === usdcMint,
    );
    if (!burnerTokenAccount) throw new BadRequestException('Burner has no USDC token account');
    const burnerAta = new PublicKey(burnerTokenAccount.pubkey);

    const destPubkey = new PublicKey(destinationSolAddress);
    const destAta = await getAssociatedTokenAddress(USDC_MINT, destPubkey);

    const tx = new Transaction();
    try { await getAccount(conn, destAta); } catch {
      tx.add(createAssociatedTokenAccountInstruction(
        feePayerKeypair.publicKey, destAta, destPubkey, USDC_MINT, TOKEN_PROGRAM_ID,
      ));
    }
    tx.add(createTransferInstruction(burnerAta, destAta, burnerKeypair.publicKey, burnerBalance));
    tx.feePayer = feePayerKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(feePayerKeypair, burnerKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize());
    const rescueConfirmation = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (rescueConfirmation.value.err) {
      throw new Error(`Burner rescue failed on-chain (${sig}): ${JSON.stringify(rescueConfirmation.value.err)}`);
    }

    this.logger.log(`Ticket ${ticketId}: burner rescued ${burnerBalance} units → ${destinationSolAddress} | tx ${sig}`);

    await db.from('lottery_tickets').update({
      status: 'failed',
      bridge_status: 'RESCUED',
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    const usdcAmount = (Number(burnerBalance) / 1_000_000).toFixed(2);
    return { ok: true, message: `$${usdcAmount} USDC rescued and sent back to your Loofta balance.` };
  }

  private async buyWithEthCompanion(opts: { ticket: any; companionPrivHex: string }): Promise<void> {
    const { ticket, companionPrivHex } = opts;
    const db = this.supabase.getClient();

    const { createPublicClient, createWalletClient, http, erc20Abi, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { base } = await import('viem/chains');

    const rpc = this.config.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
    const account = privateKeyToAccount(companionPrivHex as `0x${string}`);
    const wallet = createWalletClient({ chain: base, transport: http(rpc), account });
    const publicClient = createPublicClient({ chain: base, transport: http(rpc) });

    const ethBalance = await publicClient.getBalance({ address: account.address });
    const usdcNeeded = BigInt(ticket.num_tickets) * 1_000_000n;

    // Check if companion already has enough USDC (e.g. swap succeeded on a prior attempt but buy failed)
    const existingUsdc: bigint = await publicClient.readContract({
      address: MEGAPOT_USDC as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });

    if (existingUsdc >= usdcNeeded) {
      this.logger.log(`Ticket ${ticket.id}: companion already has ${existingUsdc} USDC — skipping ETH→USDC swap`);
    } else {
      const swapAmountInMax = ethBalance - ETH_GAS_RESERVE;
      if (swapAmountInMax <= 0n) throw new Error(`Insufficient ETH: ${ethBalance} wei`);

      this.logger.log(`Ticket ${ticket.id}: swap ETH→USDC exact out ${usdcNeeded} units, max ETH in ${swapAmountInMax}`);

      // Uniswap V3 exactOutputSingle ETH→USDC (0.3% pool — most liquidity on Base) + refundETH in one multicall
      const exactOutData = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactOutputSingle',
        args: [{
          tokenIn: WETH9_BASE,
          tokenOut: MEGAPOT_USDC,
          fee: 3000, // 0.3% — deepest WETH/USDC pool on Base
          recipient: account.address,
          amountOut: usdcNeeded,
          amountInMaximum: swapAmountInMax,
          sqrtPriceLimitX96: 0n,
        }],
      });
      const refundData = encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'refundETH', args: [] });

      const swapHash = await wallet.writeContract({
        address: SWAP_ROUTER_02,
        abi: SWAP_ROUTER_ABI,
        functionName: 'multicall',
        args: [[exactOutData, refundData]],
        value: swapAmountInMax,
        account,
      });
      const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
      if (swapReceipt.status === 'reverted') throw new Error(`ETH→USDC swap reverted (tx: ${swapHash})`);
      this.logger.log(`Ticket ${ticket.id}: ETH→USDC swap done tx:${swapHash}`);
    }

    // Approve USDC directly to the Jackpot contract — it calls transferFrom(msg.sender) internally.
    // The starter kit skips JackpotRandomTicketBuyer entirely and calls Jackpot.buyTickets directly.
    const { maxUint256 } = await import('viem');
    const approveTx = await wallet.writeContract({
      address: MEGAPOT_USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MEGAPOT_JACKPOT, maxUint256],
      account,
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (approveReceipt.status === 'reverted') throw new Error(`USDC approve (Jackpot) reverted`);
    this.logger.log(`Ticket ${ticket.id}: USDC approved → Jackpot tx:${approveTx}`);

    // Call Jackpot.buyTickets directly (same ABI as RandomBuyer but Jackpot is the actual spender)
    const buyTx = await wallet.writeContract({
      address: MEGAPOT_JACKPOT,
      abi: JACKPOT_ABI,
      functionName: 'buyTickets',
      args: [BigInt(ticket.num_tickets), account.address, this.megapot.getReferrers(), this.megapot.getSplits(), this.megapot.getSourceId()],
      account,
    });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    if (buyReceipt.status === 'reverted') throw new Error(`buyTickets reverted (tx: ${buyTx})`);
    this.logger.log(`Ticket ${ticket.id}: tickets bought tx:${buyTx}`);

    // Sweep remaining ETH to Loofta wallet
    await this.sweepEthToLoofta(wallet, publicClient, account);

    let roundId: string | null = null, drawTime: string | null = null;
    try { const round = await this.megapot.getActiveRound(); roundId = round?.id ?? null; drawTime = round?.drawTime ?? null; } catch {}

    await db.from('lottery_tickets').update({
      status: 'active',
      round_id: roundId,
      draw_time: drawTime,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    this.logger.log(`Ticket ${ticket.id}: active! ${ticket.num_tickets} public ticket(s) bought`);
  }

  private async sweepEthToLoofta(wallet: any, publicClient: any, account: any): Promise<void> {
    // Use 'pending' to include any in-flight txs so balance and nonce are from the same state
    const ethBalance = await publicClient.getBalance({ address: account.address, blockTag: 'pending' });
    if (ethBalance <= 0n) return;

    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas ?? 1_000_000n;
    const priorityFee = 100_000_000n; // 0.1 gwei tip
    const maxFeePerGas = baseFee * 2n + priorityFee;
    const gas = 21000n;
    const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });

    // Simulate the transaction to get the exact Base L1 data fee via the GasPriceOracle precompile
    const { serializeTransaction } = await import('viem');
    const txBytes = serializeTransaction({
      type: 'eip1559',
      chainId: 8453,
      nonce,
      to: LOOFTA_WALLET,
      value: 0n, // placeholder — L1 fee doesn't depend on value field
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
    });

    let l1DataFee = 50_000_000_000n; // 50 gwei fallback if oracle call fails
    try {
      const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F' as Address;
      const estimated: bigint = await publicClient.readContract({
        address: GAS_PRICE_ORACLE,
        abi: [{ name: 'getL1Fee', type: 'function', stateMutability: 'view', inputs: [{ name: '_data', type: 'bytes' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
        functionName: 'getL1Fee',
        args: [txBytes],
      });
      l1DataFee = estimated * 12n / 10n; // +20% safety margin on top of oracle estimate
      this.logger.log(`sweepEthToLoofta: L1 fee estimate=${estimated} wei, using ${l1DataFee} wei (with margin)`);
    } catch (e: any) {
      this.logger.warn(`sweepEthToLoofta: GasPriceOracle failed (${e.message}), using 50 gwei fallback`);
    }

    const gasCost = maxFeePerGas * gas + l1DataFee;
    const ethToSend = ethBalance - gasCost;
    if (ethToSend <= 0n) return;
    const hash = await wallet.sendTransaction({
      to: LOOFTA_WALLET,
      value: ethToSend,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      nonce,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(`Swept ${ethToSend} wei ETH dust → Loofta wallet, tx:${hash}`);
  }

  private async checkSolanaUsdcDeposit(depositAddress: string): Promise<number> {
    const conn = await this.getSolanaConnection();
    const pk = new PublicKey(depositAddress);

    // Fast exit: if no transactions have arrived at this address yet, skip the token-account query entirely
    const sigs = await conn.getSignaturesForAddress(pk, { limit: 1 });
    if (sigs.length === 0) return 0;

    // An account with no SPL tokens throws "Token mint could not be unpacked" — treat as 0
    try {
      const accounts = await conn.getParsedTokenAccountsByOwner(pk, { mint: USDC_MINT });
      return accounts.value.reduce(
        (sum, a) => sum + Number((a.account.data as any).parsed?.info?.tokenAmount?.uiAmount ?? 0),
        0,
      );
    } catch (e: any) {
      if (e.message?.includes('Token mint could not be unpacked') || e.message?.includes('Invalid param')) return 0;
      throw e;
    }
  }

  private async getCompanionUsdcBalance(companionAddress: string): Promise<number> {
    const { createPublicClient, http, erc20Abi } = await import('viem');
    const { base } = await import('viem/chains');
    const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
    const rpc = this.config.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
    const client = createPublicClient({ chain: base, transport: http(rpc) });
    const balance = await client.readContract({
      address: USDC_BASE,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [companionAddress as `0x${string}`],
    });
    return Number(balance) / 1_000_000;
  }

  /** After daily draw: check all active tickets for wins */
  async checkDailyResults(): Promise<void> {
    const db = this.supabase.getClient();

    // Only process tickets that are past their draw time
    // (cron runs at 00:30 UTC, draw is at ~17:10 UTC the previous day)
    const { data: tickets } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('status', 'active')
      .lt('draw_time', new Date().toISOString());

    if (!tickets?.length) {
      this.logger.log('checkDailyResults: no expired active tickets');
      return;
    }

    this.logger.log(`checkDailyResults: checking ${tickets.length} expired tickets`);

    for (const ticket of tickets) {
      try {
        // Get stored NFT IDs, falling back to on-chain Transfer event scan
        let tokenIds: string[] = Array.isArray(ticket.ticket_nft_ids) && ticket.ticket_nft_ids.length > 0
          ? ticket.ticket_nft_ids
          : [];

        if (!tokenIds.length && ticket.companion_address) {
          this.logger.log(`checkDailyResults: scanning Transfer events for ticket ${ticket.id}`);
          const { tokenIds: found, ticketNumbers } = await this.megapot.getTicketNumbersFromNft(
            ticket.companion_address as Address,
            ticket.round_id,
          );
          tokenIds = found;
          if (tokenIds.length) {
            await db.from('lottery_tickets').update({
              ticket_nft_ids: tokenIds,
              ...(ticketNumbers.length ? { ticket_numbers: ticketNumbers } : {}),
              updated_at: new Date().toISOString(),
            }).eq('id', ticket.id);
          }
        }

        if (!tokenIds.length) {
          this.logger.warn(`checkDailyResults: no NFT IDs found for ticket ${ticket.id} — marking lost`);
          await db.from('lottery_tickets').update({
            status: 'lost',
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          continue;
        }

        // Fetch winning numbers for this round (non-fatal)
        const winningNumbers = ticket.round_id
          ? await this.megapot.getWinningNumbersForRound(ticket.round_id)
          : null;

        // Read on-chain NFT metadata to check Tier + Win Amount post-draw
        const results = await this.megapot.checkTicketResultsFromNft(tokenIds);
        const grossWinUsdc = results.reduce((sum, r) => sum + r.winAmountUsdc, 0);
        // Use the NFT metadata's own on-chain "Drawing ID", NOT ticket.round_id (that's Megapot's
        // off-chain Data-API round id — passing it to getDrawingState() silently reads a zeroed
        // struct instead of reverting, understating the real referral-win-share deduction).
        const onChainDrawingId = results.find(r => r.drawingId)?.drawingId;
        const claimFactor = onChainDrawingId ? await this.megapot.getWinClaimFactor(onChainDrawingId) : 1;
        const totalWinUsdc = parseFloat((grossWinUsdc * claimFactor).toFixed(6));
        const topWin = results.find(r => r.winAmountUsdc > 0);

        if (totalWinUsdc > 0) {
          await db.from('lottery_tickets').update({
            status: 'won',
            win_amount_usdc: totalWinUsdc,
            win_tier: topWin?.tier ?? null,
            ...(winningNumbers ? { winning_numbers: winningNumbers } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: WON $${grossWinUsdc} gross → $${totalWinUsdc} net (tier ${topWin?.tier}, claimFactor=${claimFactor})`);
        } else {
          await db.from('lottery_tickets').update({
            status: 'lost',
            ...(winningNumbers ? { winning_numbers: winningNumbers } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: LOST`);
        }
      } catch (err: any) {
        this.logger.warn(`checkDailyResults ticket ${ticket.id}: ${err.message}`);
      }
    }
  }

  /** Manually check win/loss result for a single ticket. Useful after draw when cron is bypassed. */
  async checkTicketResult(ticketId: string, userId: string): Promise<{
    status: string;
    winAmountUsdc: number | null;
    winTier: number | null;
    winningNumbers: { main: number[]; bonus: number } | null;
    ticketNumbers: { main: number[]; bonus: number }[] | null;
  }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found');
    if (ticket.status === 'won' || ticket.status === 'lost') {
      return {
        status: ticket.status,
        winAmountUsdc: ticket.win_amount_usdc,
        winTier: ticket.win_tier,
        winningNumbers: ticket.winning_numbers ?? null,
        ticketNumbers: ticket.ticket_numbers ?? null,
      };
    }
    if (ticket.status !== 'active') throw new BadRequestException('Ticket is not active');
    if (!ticket.draw_time || new Date(ticket.draw_time) > new Date()) {
      // draw_time missing or future — check via Megapot API using roundId
      if (!ticket.round_id) throw new BadRequestException('Draw has not happened yet');
      let round: any;
      try { round = await this.megapot.getRound(ticket.round_id); } catch { round = null; }
      const roundDt = round?.drawTime ? new Date(round.drawTime) : null;
      if (!roundDt || roundDt > new Date()) throw new BadRequestException('Draw has not happened yet');
      // Round has drawn — persist the recovered draw_time so future calls are instant
      await db.from('lottery_tickets').update({ draw_time: round.drawTime, updated_at: new Date().toISOString() }).eq('id', ticketId);
    }

    // Get or fetch NFT IDs
    let tokenIds: string[] = Array.isArray(ticket.ticket_nft_ids) && ticket.ticket_nft_ids.length > 0
      ? ticket.ticket_nft_ids
      : [];

    if (!tokenIds.length && ticket.companion_address) {
      const { tokenIds: found, ticketNumbers } = await this.megapot.getTicketNumbersFromNft(
        ticket.companion_address as Address,
        ticket.round_id,
      );
      tokenIds = found;
      if (tokenIds.length) {
        await db.from('lottery_tickets').update({
          ticket_nft_ids: tokenIds,
          ...(ticketNumbers.length ? { ticket_numbers: ticketNumbers } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', ticketId);
      }
    }

    if (!tokenIds.length) {
      // NFT scan found nothing — try the Data API wins endpoint as a last resort
      if (ticket.companion_address && ticket.round_id) {
        const apiWin = await this.megapot.getWalletWinsForRound(
          ticket.companion_address as Address,
          ticket.round_id,
        );
        if (apiWin) {
          const winningNumbers = await this.megapot.getWinningNumbersForRound(ticket.round_id);
          // No NFT metadata available on this last-resort path, so there's no real on-chain
          // "Drawing ID" to look up getDrawingState() with — ticket.round_id is the Data-API's
          // off-chain id, which getWinClaimFactor cannot use (see checkDailyResults). Applying no
          // factor here means this branch shows the gross amount pre-claim; the actual redeem
          // still reconciles win_amount_usdc to the real claimed companion balance afterward, so
          // this is a display-only gap in this rare fallback, not a fund-safety issue.
          const apiClaimFactor = 1;
          const netApiWin = parseFloat((apiWin.winAmountUsdc * apiClaimFactor).toFixed(6));
          await db.from('lottery_tickets').update({
            status: 'won',
            win_amount_usdc: netApiWin,
            win_tier: apiWin.tier,
            ...(winningNumbers ? { winning_numbers: winningNumbers } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', ticketId);
          this.logger.log(`checkTicketResult ${ticketId}: WON $${apiWin.winAmountUsdc} gross → $${netApiWin} net (Data API, claimFactor=${apiClaimFactor})`);
          return { status: 'won', winAmountUsdc: netApiWin, winTier: apiWin.tier, winningNumbers: winningNumbers ?? null, ticketNumbers: ticket.ticket_numbers ?? null };
        }
      }
      await db.from('lottery_tickets').update({ status: 'lost', updated_at: new Date().toISOString() }).eq('id', ticketId);
      return { status: 'lost', winAmountUsdc: null, winTier: null, winningNumbers: null, ticketNumbers: ticket.ticket_numbers ?? null };
    }

    // Fetch winning numbers for this round (non-fatal)
    const winningNumbers = ticket.round_id
      ? await this.megapot.getWinningNumbersForRound(ticket.round_id)
      : null;

    const results = await this.megapot.checkTicketResultsFromNft(tokenIds);
    const grossWinUsdc = results.reduce((sum, r) => sum + r.winAmountUsdc, 0);
    // Real on-chain drawing id from the NFT metadata itself — see checkDailyResults for why
    // ticket.round_id (Megapot's off-chain Data-API id) must not be used here.
    const onChainDrawingId = results.find(r => r.drawingId)?.drawingId;
    const nftClaimFactor = onChainDrawingId ? await this.megapot.getWinClaimFactor(onChainDrawingId) : 1;
    const totalWinUsdc = parseFloat((grossWinUsdc * nftClaimFactor).toFixed(6));
    const topWin = results.find(r => r.winAmountUsdc > 0);

    if (totalWinUsdc > 0) {
      await db.from('lottery_tickets').update({
        status: 'won',
        win_amount_usdc: totalWinUsdc,
        win_tier: topWin?.tier ?? null,
        ...(winningNumbers ? { winning_numbers: winningNumbers } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', ticketId);
      this.logger.log(`checkTicketResult ${ticketId}: WON $${grossWinUsdc} gross → $${totalWinUsdc} net (tier ${topWin?.tier}, claimFactor=${nftClaimFactor})`);
      return { status: 'won', winAmountUsdc: totalWinUsdc, winTier: topWin?.tier ?? null, winningNumbers: winningNumbers ?? null, ticketNumbers: ticket.ticket_numbers ?? null };
    } else {
      await db.from('lottery_tickets').update({
        status: 'lost',
        ...(winningNumbers ? { winning_numbers: winningNumbers } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', ticketId);
      this.logger.log(`checkTicketResult ${ticketId}: LOST`);
      return { status: 'lost', winAmountUsdc: null, winTier: null, winningNumbers: winningNumbers ?? null, ticketNumbers: ticket.ticket_numbers ?? null };
    }
  }

  // ─── Withdrawals ───────────────────────────────────────────────────────────

  /** Single-ticket withdrawal (base or private). Private route delegates to initiateWithdrawalBatch. */
  async initiateWithdrawal(opts: {
    ticketId: string;
    userId: string;
    route: 'base' | 'solana_private';
    destinationAddress: string;
  }): Promise<{ withdrawalId: string }> {
    if (opts.route === 'solana_private') {
      const { withdrawalIds } = await this.initiateWithdrawalBatch({
        ticketIds: [opts.ticketId],
        userId: opts.userId,
        destinationAddress: opts.destinationAddress,
      });
      return { withdrawalId: withdrawalIds[0] };
    }

    // Base route: direct USDC transfer on-chain (unchanged)
    const db = this.supabase.getClient();
    const { data: ticket, error: tErr } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('id', opts.ticketId)
      .eq('user_id', opts.userId)
      .eq('status', 'won')
      .single();

    if (tErr || !ticket) throw new BadRequestException('Ticket not found or not won');
    if (!ticket.win_amount_usdc || ticket.win_amount_usdc <= 0) throw new BadRequestException('No winnings to withdraw');

    // Same idempotency guard as initiateWithdrawalBatch — ticket.status stays 'won' throughout
    // the whole withdrawal pipeline, so a duplicate call (e.g. refresh + re-click) would otherwise
    // create a second withdrawal row racing the first.
    const { data: existingInFlight } = await db
      .from('lottery_withdrawals')
      .select('id')
      .eq('ticket_id', opts.ticketId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingInFlight) {
      this.logger.log(`initiateWithdrawal: ticket ${opts.ticketId} already has an in-flight withdrawal — returning it`);
      return { withdrawalId: existingInFlight.id };
    }

    const { data: withdrawal, error: wErr } = await db
      .from('lottery_withdrawals')
      .insert({
        user_id: opts.userId,
        ticket_id: opts.ticketId,
        route: 'base',
        destination_address: opts.destinationAddress,
        amount_usdc: ticket.win_amount_usdc,
        status: 'pending',
      })
      .select('id')
      .single();

    if (wErr || !withdrawal) throw new Error(`Failed to create withdrawal: ${wErr?.message}`);

    this.processWithdrawal(withdrawal.id, ticket).catch(e =>
      this.logger.error(`Withdrawal ${withdrawal.id} failed: ${e.message}`),
    );

    return { withdrawalId: withdrawal.id };
  }

  /**
   * Batch private withdrawal: multiple companion wallets → one shared burner → single MagicBlock.
   * Works for single tickets too (batch of 1).
   */
  async initiateWithdrawalBatch(opts: {
    ticketIds: string[];
    userId: string;
    destinationAddress: string;
  }): Promise<{ withdrawalIds: string[]; batchId: string }> {
    if (!opts.ticketIds.length) throw new BadRequestException('No ticket IDs provided');
    const db = this.supabase.getClient();

    const { data: tickets, error: tErr } = await db
      .from('lottery_tickets')
      .select('*')
      .in('id', opts.ticketIds)
      .eq('user_id', opts.userId)
      .eq('status', 'won');

    if (tErr || !tickets?.length) {
      // Check if all these tickets are already withdrawn — return gracefully if so
      const { data: alreadyWithdrawn } = await db
        .from('lottery_tickets')
        .select('id, status')
        .in('id', opts.ticketIds)
        .eq('user_id', opts.userId)
        .eq('status', 'withdrawn');
      if (alreadyWithdrawn?.length === opts.ticketIds.length) {
        throw new BadRequestException('Winnings already withdrawn');
      }
      throw new BadRequestException('No eligible won tickets found');
    }

    for (const t of tickets) {
      if (!t.win_amount_usdc || parseFloat(t.win_amount_usdc) <= 0) {
        throw new BadRequestException(`Ticket ${t.id} has no winnings to withdraw`);
      }
    }

    // Idempotency guard: a ticket's status stays 'won' for the ENTIRE claim → bridge → deliver
    // pipeline (only flips to 'withdrawn' at the very end), so without this check a duplicate
    // call — e.g. a page refresh mid-redeem followed by the user clicking "Redeem" again — would
    // find the same tickets still eligible and spin up a second batch racing the first to claim
    // the same companion wallets. If any of these tickets already has a withdrawal in flight,
    // return that existing batch instead of creating a new one.
    const { data: inFlight } = await db
      .from('lottery_withdrawals')
      .select('id, ticket_id, batch_id')
      .in('ticket_id', tickets.map(t => t.id))
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });
    if (inFlight?.length) {
      const existingBatchId = inFlight[0].batch_id;
      const covered = new Set(inFlight.filter(w => w.batch_id === existingBatchId).map(w => w.ticket_id));
      const allCovered = tickets.every(t => covered.has(t.id));
      if (!allCovered) {
        // Partial overlap — some requested tickets are mid-flight in one batch, others aren't in
        // any batch. Refuse rather than guess: creating a new batch for just the uncovered
        // tickets would silently drop the caller's expectation that this call handles all of them.
        throw new BadRequestException('Some of these tickets already have a withdrawal in progress — try again in a moment.');
      }
      this.logger.log(`initiateWithdrawalBatch: ${tickets.length} ticket(s) already have an in-flight withdrawal — returning existing batch ${existingBatchId}`);
      return {
        withdrawalIds: inFlight.filter(w => w.batch_id === existingBatchId).map(w => w.id),
        batchId: existingBatchId,
      };
    }

    // One shared burner Solana wallet for the entire batch
    const burner = Keypair.generate();
    const burnerAddress = burner.publicKey.toBase58();
    const burnerKeyEnc = this.enc.encrypt(Buffer.from(burner.secretKey), burnerAddress);
    const batchId = randomUUID();

    const insertData = tickets.map(t => ({
      user_id: opts.userId,
      ticket_id: t.id,
      batch_id: batchId,
      route: 'solana_private' as const,
      destination_address: opts.destinationAddress,
      amount_usdc: parseFloat(t.win_amount_usdc),
      status: 'pending',
      withdrawal_burner_sol_address: burnerAddress,
      withdrawal_burner_sol_key_enc: burnerKeyEnc,
    }));

    const { data: withdrawals, error: wErr } = await db
      .from('lottery_withdrawals')
      .insert(insertData)
      .select('id, ticket_id');

    if (wErr || !withdrawals?.length) throw new Error(`Failed to create batch withdrawals: ${wErr?.message}`);

    // Consolidate: claim every companion, sweep them all into one "lead" companion on Base
    // (Rhinestone-sponsored, ~free), then bridge ONCE. Across charges a mostly-fixed ~$0.16 fee
    // per bridge regardless of size, so bridging each ticket separately (the old behaviour) paid
    // that fixed fee N times — brutal on small wins (a $1 ticket lost 16% to its own bridge).
    this.processConsolidatedBatch(batchId, tickets, withdrawals, burnerAddress).catch(e =>
      this.logger.error(`Batch withdrawal ${batchId}: ${e.message}`),
    );

    this.logger.log(`Batch withdrawal ${batchId}: ${tickets.length} tickets → burner ${burnerAddress}`);
    return { withdrawalIds: withdrawals.map(w => w.id), batchId };
  }

  /**
   * Consolidated batch processing: claim all winnings, sweep every companion's USDC into a single
   * lead companion, then do ONE Li.Fi bridge to the shared burner (instead of one per ticket).
   * The final MagicBlock transfer already fires once for the whole batch. Net effect: the fixed
   * per-bridge fee is paid once, not N times.
   */
  private async processConsolidatedBatch(
    batchId: string,
    tickets: any[],
    withdrawals: { id: string; ticket_id: string }[],
    burnerAddress: string,
  ): Promise<void> {
    const db = this.supabase.getClient();
    const B = `[Batch ${batchId.slice(0, 8)}]`;
    const widByTicket = new Map(withdrawals.map(w => [w.ticket_id, w.id]));

    // ── Step 1: claim every ticket's winnings into its own companion ──────────
    const claimed: { ticket: any; withdrawalId: string; balance: number }[] = [];
    for (const ticket of tickets) {
      const withdrawalId = widByTicket.get(ticket.id);
      if (!withdrawalId) continue;
      const W = `[Withdrawal ${withdrawalId.slice(0, 8)}]`;
      try {
        const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
        const companionPrivHex = `0x${companionKey.toString('hex')}`;

        if (!ticket.claim_tx_hash) {
          const preSmartUsdc = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0);
          if (preSmartUsdc >= ticket.win_amount_usdc - 0.15) {
            await db.from('lottery_tickets').update({ claim_tx_hash: 'already_claimed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
          } else {
            const allNftIds: string[] = ticket.ticket_nft_ids ?? [];
            const nftResults = await this.megapot.checkTicketResultsFromNft(allNftIds);
            const winningNftIds = nftResults.filter(r => r.winAmountUsdc > 0).map(r => BigInt(r.tokenId));
            if (winningNftIds.length === 0) throw new Error(`No winning NFT IDs found among ${allNftIds.length} ticket NFTs`);
            const claimTx = await this.rhinestone.claimWinnings({ companionPrivateKey: companionPrivHex as `0x${string}`, ticketNftIds: winningNftIds });
            await db.from('lottery_tickets').update({ claim_tx_hash: claimTx, updated_at: new Date().toISOString() }).eq('id', ticket.id);
            this.logger.log(`${W} claimed → ${claimTx}`);
          }
        }
        await db.from('lottery_withdrawals').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', withdrawalId);

        // Real claimed balance — the source of truth for this ticket's actual win (NFT metadata
        // has proven unreliable). claimWinnings already waited for on-chain execution, so the USDC
        // is there; retry the read a few times to ride out any RPC-node lag before concluding.
        let balance = 0;
        for (let attempt = 0; attempt < 4; attempt++) {
          balance = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0);
          if (balance > 0) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        if (balance > 0) {
          await db.from('lottery_tickets').update({ win_amount_usdc: balance, updated_at: new Date().toISOString() }).eq('id', ticket.id);
          await db.from('lottery_withdrawals').update({ amount_usdc: balance, updated_at: new Date().toISOString() }).eq('id', withdrawalId);
          claimed.push({ ticket, withdrawalId, balance });
        } else {
          // Claim recorded on-chain (claim_tx_hash set) but the companion still reads $0 — almost
          // certainly RPC lag, NOT a real failure. Do NOT mark failed (that would strand a real
          // win); leave it 'processing' so recoverStuckConsolidatedBatches bridges it once the
          // balance materialises. Only a claim that actually threw lands in the catch below.
          this.logger.warn(`${W} balance still $0 after claim + retries — leaving 'processing' for recovery cron (funds safe in companion)`);
        }
      } catch (err: any) {
        await db.from('lottery_withdrawals').update({ status: 'failed', error_message: err.message, updated_at: new Date().toISOString() }).eq('id', withdrawalId);
        this.logger.error(`${W} claim/reconcile failed: ${err.message}`);
      }
    }

    if (!claimed.length) {
      this.logger.error(`${B} no tickets successfully claimed — nothing to bridge`);
      return;
    }

    // ── Step 2: pick the largest-balance companion as lead, sweep the rest into it ──
    claimed.sort((a, b) => b.balance - a.balance);
    const lead = claimed[0];
    const leadKey = this.decryptKey(lead.ticket.companion_key_enc, lead.ticket.companion_address);
    const leadPrivHex = `0x${leadKey.toString('hex')}`;
    const leadAddress = lead.ticket.companion_address as Address;

    for (const c of claimed.slice(1)) {
      const W = `[Withdrawal ${c.withdrawalId.slice(0, 8)}]`;
      try {
        const cKey = this.decryptKey(c.ticket.companion_key_enc, c.ticket.companion_address);
        await this.rhinestone.rescueUsdc({
          companionPrivateKey: `0x${cKey.toString('hex')}` as `0x${string}`,
          rescueWallet: leadAddress,
          amountUsdc: c.balance,
        });
        this.logger.log(`${W} swept ${c.balance.toFixed(6)} USDC → lead companion ${leadAddress.slice(0, 10)}…`);
        // Folded into the lead's single bridge. Marked 'consolidated' (NOT 'done') so it's
        // distinguishable from a real completed bridge: tryCompleteBatch treats it as settled, but
        // recovery must NOT read it as "a bridge succeeded" (only the lead's real bridge does).
        await db.from('lottery_withdrawals').update({ bridge_status: 'consolidated', updated_at: new Date().toISOString() }).eq('id', c.withdrawalId);
      } catch (err: any) {
        this.logger.error(`${W} sweep to lead failed: ${err.message} — leaving as its own bridge`);
        // Fallback: if the sweep fails, bridge this companion on its own so funds aren't stranded.
        const cKey = this.decryptKey(c.ticket.companion_key_enc, c.ticket.companion_address);
        await this.bridgeCompanionToBurner({
          withdrawalId: c.withdrawalId,
          companionPrivHex: `0x${cKey.toString('hex')}`,
          companionAddress: c.ticket.companion_address,
          burnerAddress,
          amountUsdc: c.balance,
        }).catch(e => this.logger.error(`${W} fallback bridge failed: ${e.message}`));
      }
    }

    // ── Step 3: ONE bridge from the lead companion (now holding the consolidated total) ──
    // Read the real on-chain balance with retries — NEVER fall back to lead.balance (its own
    // pre-sweep claim), which would bridge only part and strand every swept-in amount. The sweeps
    // used waitForExecution so the funds are on-chain; a persistently-failing read means we abort
    // and let recoverStuckConsolidatedBatches bridge the (safe, intact) lead companion later.
    const expectedTotal = claimed.reduce((s, c) => s + c.balance, 0);
    let leadTotal = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      leadTotal = await this.getCompanionUsdcBalance(leadAddress).catch(() => 0);
      // Consider the read trustworthy once it reflects essentially the full consolidated sum.
      if (leadTotal >= expectedTotal - 0.01) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (leadTotal <= 0.005) {
      this.logger.error(`${B} lead companion balance read $${leadTotal.toFixed(6)} (expected ~$${expectedTotal.toFixed(6)}) — aborting bridge, recovery cron will pick it up (funds safe in lead)`);
      return;
    }
    this.logger.log(`${B} bridging consolidated ${leadTotal.toFixed(6)} USDC from lead → burner (1 bridge for ${claimed.length} ticket(s), expected ~$${expectedTotal.toFixed(6)})`);
    await this.bridgeCompanionToBurner({
      withdrawalId: lead.withdrawalId,
      companionPrivHex: leadPrivHex,
      companionAddress: leadAddress,
      burnerAddress,
      amountUsdc: leadTotal,
    });
  }

  async processWithdrawal(withdrawalId: string, ticket: any): Promise<void> {
    const db = this.supabase.getClient();
    const { data: withdrawal } = await db.from('lottery_withdrawals').select('*').eq('id', withdrawalId).single();
    if (!withdrawal) return;

    const W = `[Withdrawal ${withdrawalId.slice(0, 8)}]`;
    const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
    const companionPrivHex = `0x${companionKey.toString('hex')}`;

    try {
      // ── Step 1: claimWinnings ──────────────────────────────────────────────
      if (!ticket.claim_tx_hash) {
        // Guard: if USDC is already at the smart account, a prior Rhinestone claimWinnings
        // succeeded but the DB write was lost (e.g. a crash). Skip re-claiming so we don't
        // hit TokenDoesNotExist on an already-burned NFT.
        const preSmartUsdc = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0);

        if (preSmartUsdc >= withdrawal.amount_usdc - 0.15) {
          this.logger.log(`${W} step 1/3 skip — USDC already at smart account (${preSmartUsdc.toFixed(6)} USDC), claim already happened on-chain`);
          await db.from('lottery_tickets').update({ claim_tx_hash: 'already_claimed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
        } else {
          const allNftIds: string[] = ticket.ticket_nft_ids ?? [];

          // From a batch purchase only the WINNING NFTs can be passed to claimWinnings.
          // Passing losing NFT IDs causes Megapot to revert (TokenDoesNotExist).
          this.logger.log(`${W} step 1/3 — checking ${allNftIds.length} NFT IDs for winners`);
          const nftResults = await this.megapot.checkTicketResultsFromNft(allNftIds);
          const winningNftIds = nftResults
            .filter(r => r.winAmountUsdc > 0)
            .map(r => BigInt(r.tokenId));

          if (winningNftIds.length === 0) {
            throw new Error(`No winning NFT IDs found among ${allNftIds.length} ticket NFTs — check ticket status`);
          }
          this.logger.log(`${W} step 1/3 — ${winningNftIds.length}/${allNftIds.length} NFTs are winners → claimWinnings`);

          this.logger.log(`${W} step 1/3 — Rhinestone sponsored claim (smart account=${ticket.companion_address})`);
          const claimTx = await this.rhinestone.claimWinnings({
            companionPrivateKey: companionPrivHex as `0x${string}`,
            ticketNftIds: winningNftIds,
          });
          this.logger.log(`${W} step 1/3 done — Rhinestone claim ok, claimTx=${claimTx}`);

          await db.from('lottery_tickets').update({ claim_tx_hash: claimTx, updated_at: new Date().toISOString() }).eq('id', ticket.id);
        }
      } else {
        this.logger.log(`${W} step 1/3 skip — already claimed (${ticket.claim_tx_hash.slice(0, 16)}…)`);
      }

      await db.from('lottery_withdrawals').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', withdrawalId);

      // ── Step 2: bridge ────────────────────────────────────────────────────
      if (withdrawal.route === 'base') {
        this.logger.log(`${W} step 2/3 — transfer ${withdrawal.amount_usdc} USDC directly on Base to ${withdrawal.destination_address}`);
        const tx = await this.megapot.transferUsdcOnBase({
          companionPrivateKey: companionPrivHex,
          to: withdrawal.destination_address as Address,
          amountUsdc: withdrawal.amount_usdc,
        });
        await db.from('lottery_withdrawals').update({ status: 'complete', base_tx_hash: tx, updated_at: new Date().toISOString() }).eq('id', withdrawalId);
        this.logger.log(`${W} complete — ${withdrawal.amount_usdc} USDC on Base, tx=${tx}`);
      } else {
        this.logger.log(`${W} step 2/3 — starting Li.Fi bridge (Base→SOL) for ${withdrawal.amount_usdc} USDC`);
        await this.processLifiWithdrawal(withdrawalId, withdrawal, companionPrivHex, ticket);
        // step 3 (MagicBlock) fires in checkLifiWithdrawal when bridge confirms
      }
    } catch (err: any) {
      await db.from('lottery_withdrawals').update({
        status: 'failed',
        error_message: err.message,
        updated_at: new Date().toISOString(),
      }).eq('id', withdrawalId);
      this.logger.error(`${W} FAILED: ${err.message}`);
    }
  }

  /**
   * Estimate what a private (Solana) withdrawal actually delivers, mirroring the real pipeline so
   * the "you receive" figure matches what lands: one Li.Fi bridge (Base→Solana) then the MagicBlock
   * private transfer. Post-consolidation there is exactly ONE bridge for the whole redeem, so
   * estimating on the total is accurate. Returns net delivered + total fee.
   */
  /**
   * MagicBlock's gasless relay fee in USDC = its 0.002 SOL gas cost priced at the LIVE SOL/USD
   * rate (NOT a hardcoded dollar amount — SOL moves, so a fixed $0.20 drifts wrong). Falls back to
   * the documented flat value only if the price feed is unreachable.
   */
  private async magicblockRelayFeeUsdc(): Promise<number> {
    const solPrice = await fetchSolPriceUsd().catch(() => null);
    if (!solPrice || solPrice <= 0) return MAGICBLOCK_GAS_USDC;
    return MAGICBLOCK_GAS_SOL * solPrice;
  }

  async estimatePrivateWithdrawalNet(amountUsdc: number): Promise<{ feeUsd: number; receiveUsdc: number }> {
    // 1. Bridge leg: what actually lands in the burner (Li.Fi's guaranteed min out).
    const bridge = await this.lifi.getWithdrawalFeeEstimate(amountUsdc);
    const bridgeReceive = bridge.receiveUsdc;

    // 2. MagicBlock leg — mirror doMagicBlockTransfer exactly:
    //    gasless path (net ≥ $5): relay fee (0.002 SOL priced live) + 10 bps volume fee, exactOut.
    //    below $5: falls back to a direct SPL transfer (Loofta's fee payer covers gas), so the full
    //    bridged amount is delivered with no MagicBlock fee.
    const relayFee = await this.magicblockRelayFeeUsdc();
    const afterRelay = bridgeReceive - relayFee;
    const gaslessNet = afterRelay > 0 ? afterRelay * (10_000 - MAGICBLOCK_VOLUME_FEE_BPS) / 10_000 : 0;

    const net = gaslessNet >= 5 ? gaslessNet : bridgeReceive;
    const receiveUsdc = parseFloat(Math.max(0, net).toFixed(6));
    const feeUsd = parseFloat(Math.max(0, amountUsdc - receiveUsdc).toFixed(6));
    return { feeUsd, receiveUsdc };
  }

  /**
   * Crash/failure safety net for consolidated batches. `processConsolidatedBatch` claims → sweeps
   * into a lead companion → does one lead bridge. If it crashes before the bridge, OR the lead
   * bridge itself returns FAILED, all the batch's USDC sits in a Loofta-controlled companion with
   * nothing to move it. This cron is companion-balance-driven: for any non-complete batch that's
   * been idle a few minutes with NO real bridge succeeded or in flight, it finds whichever
   * companion still holds USDC and (re)bridges it to the burner. Funds are never lost — only
   * temporarily stuck — and this makes recovery automatic instead of a manual rescue.
   */
  private recoveringBatches = false;

  async recoverStuckConsolidatedBatches(): Promise<void> {
    if (this.recoveringBatches) return;
    this.recoveringBatches = true;
    try {
      const db = this.supabase.getClient();
      const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
      // Candidate batches: have at least one leg still 'processing' or 'failed' and idle a while.
      const { data: candidates } = await db
        .from('lottery_withdrawals')
        .select('batch_id')
        .eq('route', 'solana_private')
        .not('batch_id', 'is', null)
        .in('status', ['processing', 'failed'])
        .lt('updated_at', threeMinAgo)
        .limit(60);
      if (!candidates?.length) return;
      const batchIds = [...new Set(candidates.map((c: any) => c.batch_id))];

      for (const batchId of batchIds) {
        const B = `[Batch ${batchId.slice(0, 8)}]`;
        const { data: allRows } = await db.from('lottery_withdrawals').select('*').eq('batch_id', batchId);
        if (!allRows?.length) continue;

        // Gate on the batch's NEWEST activity, not per-row: a large batch mid-claim has old rows
        // but recent ones — leave it to finish rather than racing processConsolidatedBatch.
        if (allRows.some((r: any) => r.updated_at >= threeMinAgo)) continue;

        // A REAL bridge succeeded ('done', not the 'consolidated' fold-in marker) → the burner is
        // funded and the MagicBlock path owns delivery; never re-bridge. A live bridge in flight →
        // wait for it. Either way, hands off.
        const realBridgeDoneOrInFlight = allRows.some((r: any) =>
          r.bridge_status === 'done' ||
          (r.lifi_tx_hash && r.bridge_status === 'pending' && r.status !== 'failed' && r.status !== 'complete'),
        );
        if (realBridgeDoneOrInFlight) continue;

        // No bridge has moved the money and none is pending — find the companion still holding it.
        for (const w of allRows) {
          if (w.status === 'complete' || !w.ticket_id) continue;
          const { data: ticket } = await db.from('lottery_tickets').select('*').eq('id', w.ticket_id).single();
          if (!ticket) continue;
          const bal = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0);
          if (bal <= 0.005) continue; // this companion is empty (already swept/bridged)
          this.logger.warn(`${B} RECOVERY — companion ${ticket.companion_address.slice(0, 10)}… holds ${bal.toFixed(6)} USDC with no successful bridge; (re)bridging via row ${w.id.slice(0, 8)}`);
          // Reuse this row for the bridge. Reset any prior failed/partial bridge state so
          // checkLifiWithdrawal will poll the fresh lifi_tx_hash.
          await db.from('lottery_withdrawals')
            .update({ status: 'processing', lifi_tx_hash: null, bridge_status: null, error_message: null, updated_at: new Date().toISOString() })
            .eq('id', w.id);
          const key = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
          await this.bridgeCompanionToBurner({
            withdrawalId: w.id,
            companionPrivHex: `0x${key.toString('hex')}`,
            companionAddress: ticket.companion_address,
            burnerAddress: w.withdrawal_burner_sol_address,
            amountUsdc: bal,
          }).catch(e => this.logger.error(`${B} recovery bridge failed: ${e.message}`));
          break; // one bridge per batch per tick; a split balance is picked up next tick
        }
      }
    } finally {
      this.recoveringBatches = false;
    }
  }

  /** Li.Fi bridge: Base USDC (companion) → Solana USDC (shared burner). */
  private async processLifiWithdrawal(
    withdrawalId: string,
    withdrawal: any,
    companionPrivHex: string,
    ticket: any,
  ): Promise<void> {
    const db = this.supabase.getClient();
    const W = `[Withdrawal ${withdrawalId.slice(0, 8)}]`;
    const burnerAddress = withdrawal.withdrawal_burner_sol_address as string;
    if (!burnerAddress) throw new Error('Batch burner address not set on withdrawal record');

    // USDC is at the smart account (companion_address) after Rhinestone-sponsored claimWinnings.
    // Use actual on-chain balance rather than recorded win amount — Megapot applies a ~10% protocol
    // fee on payout so NFT metadata "Win Amount" overstates the actual received amount.
    const smartAcctUsdc = await this.getCompanionUsdcBalance(ticket.companion_address).catch(() => null);
    this.logger.log(`${W} Li.Fi: USDC check — smartAcct=${ticket.companion_address}:${smartAcctUsdc ?? '?'}`);

    // Trust the real on-chain balance over the NFT-metadata-derived estimate — that estimate has
    // been wrong in BOTH directions in production (overstated for some tickets, crushed to near-
    // zero for others). Capping at the stored estimate when the real balance is higher used to
    // silently strand the excess in the companion wallet; bridge whatever is actually there.
    const bridgeAmount = smartAcctUsdc ?? withdrawal.amount_usdc;

    if (Math.abs(bridgeAmount - withdrawal.amount_usdc) > 0.005) {
      await db.from('lottery_tickets')
        .update({ win_amount_usdc: bridgeAmount, updated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      await db.from('lottery_withdrawals')
        .update({ amount_usdc: bridgeAmount, updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id);
      this.logger.log(`${W} updated win_amount_usdc: ${withdrawal.amount_usdc.toFixed(6)} (estimate) → ${bridgeAmount.toFixed(6)} (actual on-chain)`);
    }

    await this.bridgeCompanionToBurner({
      withdrawalId,
      companionPrivHex,
      companionAddress: ticket.companion_address as string,
      burnerAddress,
      amountUsdc: bridgeAmount,
    });
  }

  /**
   * Single Li.Fi bridge: companion USDC (Base) → shared burner (Solana). Sets lifi_tx_hash on the
   * withdrawal row; the cron polls it to DONE and then fires the batch's one MagicBlock transfer.
   * Kept free of any per-ticket win-amount reconciliation so it can bridge a *consolidated* lead
   * balance without misattributing the whole total to the lead ticket.
   */
  private async bridgeCompanionToBurner(opts: {
    withdrawalId: string;
    companionPrivHex: string;
    companionAddress: string;
    burnerAddress: string;
    amountUsdc: number;
  }): Promise<string> {
    const db = this.supabase.getClient();
    const W = `[Withdrawal ${opts.withdrawalId.slice(0, 8)}]`;
    const quote = await this.lifi.getBaseToSolQuote({
      fromAddress: opts.companionAddress,
      toAddress: opts.burnerAddress,
      amountUsdc: opts.amountUsdc,
    });
    const feeUsd = this.lifi.feeFromQuote(quote);
    const receiveUsdc = parseFloat(quote.estimate.toAmountMin) / 1_000_000;
    this.logger.log(`${W} Li.Fi: quote via ${quote.tool} — send ${opts.amountUsdc.toFixed(6)} USDC, receive min ${receiveUsdc.toFixed(4)} USDC, fee ~$${feeUsd.toFixed(4)}`);

    const txHash = await this.rhinestone.executeLifiSwap({
      companionPrivateKey: opts.companionPrivHex as `0x${string}`,
      approvalAddress: quote.estimate.approvalAddress as Address | undefined,
      fromAmountRaw: BigInt(quote.estimate.fromAmount),
      swapTo: quote.transactionRequest.to as Address,
      swapData: quote.transactionRequest.data as `0x${string}`,
      swapValue: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : 0n,
      toChainAddress: opts.burnerAddress,
    });

    await db.from('lottery_withdrawals').update({
      lifi_tx_hash: txHash,
      lifi_step_tool: quote.tool,
      bridge_status: 'pending',
      updated_at: new Date().toISOString(),
    }).eq('id', opts.withdrawalId);

    this.logger.log(`${W} Li.Fi bridge submitted — tool=${quote.tool} tx=${txHash} → waiting for DONE (polls every cron tick)`);
    return txHash;
  }

  private withdrawalsRunning = false;

  /** Cron: check pending Li.Fi bridges → trigger MagicBlock when done. */
  async processPendingWithdrawals(): Promise<void> {
    if (this.withdrawalsRunning) return; // overlap guard — concurrent runs would double-send the MagicBlock transfer
    this.withdrawalsRunning = true;
    try {
      await this.processPendingWithdrawalsInner();
    } finally {
      this.withdrawalsRunning = false;
    }
  }

  private async processPendingWithdrawalsInner(): Promise<void> {
    const db = this.supabase.getClient();

    // Li.Fi based withdrawals (new): bridge in-flight
    const { data: lifiWithdrawals } = await db
      .from('lottery_withdrawals')
      .select('*')
      .eq('route', 'solana_private')
      .eq('status', 'processing')
      .not('lifi_tx_hash', 'is', null)
      .neq('bridge_status', 'done');

    if (lifiWithdrawals?.length) this.logger.log(`processPendingWithdrawals: ${lifiWithdrawals.length} Li.Fi in-flight`);

    for (const w of lifiWithdrawals ?? []) {
      await this.checkLifiWithdrawal(w).catch(e =>
        this.logger.warn(`Withdrawal ${w.id} (Li.Fi): ${e.message}`),
      );
    }

    // Retry: bridge done but MagicBlock step not yet complete (e.g. MagicBlock errored last time)
    const { data: magicblockRetries } = await db
      .from('lottery_withdrawals')
      .select('*')
      .eq('route', 'solana_private')
      .eq('status', 'processing')
      .eq('bridge_status', 'done')
      .is('magicblock_tx_hash', null);

    if (magicblockRetries?.length) {
      this.logger.log(`processPendingWithdrawals: ${magicblockRetries.length} MagicBlock retries`);
      for (const w of magicblockRetries) {
        const retry = async () => {
          if (w.batch_id) {
            await this.tryCompleteBatch(w.batch_id, w);
          } else {
            await this.doMagicBlockTransfer(w, w.amount_usdc);
          }
        };
        await retry().catch(e => this.logger.warn(`Withdrawal ${w.id} (MagicBlock retry): ${e.message}`));
      }
    }

    // Legacy NEAR Intents withdrawals (backward compat for existing records)
    const { data: nearWithdrawals } = await db
      .from('lottery_withdrawals')
      .select('*')
      .eq('route', 'solana_private')
      .eq('status', 'processing')
      .is('lifi_tx_hash', null)
      .not('bridge_deposit_address', 'is', null);

    for (const w of nearWithdrawals ?? []) {
      await this.tryCompleteNearWithdrawal(w).catch(e =>
        this.logger.warn(`Withdrawal ${w.id} (NEAR): ${e.message}`),
      );
    }
  }

  private async checkLifiWithdrawal(withdrawal: any): Promise<void> {
    const db = this.supabase.getClient();
    const W = `[Withdrawal ${withdrawal.id.slice(0, 8)}]`;
    const status = await this.lifi.getStatus(withdrawal.lifi_tx_hash, withdrawal.lifi_step_tool, 'base_to_sol');
    this.logger.log(`${W} Li.Fi bridge status=${status} tool=${withdrawal.lifi_step_tool} tx=${withdrawal.lifi_tx_hash?.slice(0, 16)}…`);

    if (status === 'FAILED') {
      await db.from('lottery_withdrawals').update({
        status: 'failed',
        error_message: 'Li.Fi bridge failed',
        updated_at: new Date().toISOString(),
      }).eq('id', withdrawal.id);
      this.logger.warn(`${W} Li.Fi bridge FAILED — withdrawal marked failed`);
      return;
    }

    if (status !== 'DONE') {
      this.logger.log(`${W} bridge still in flight — will check again next cron tick`);
      return;
    }

    this.logger.log(`${W} Li.Fi bridge DONE — USDC should be at burner ${withdrawal.withdrawal_burner_sol_address}`);
    await db.from('lottery_withdrawals').update({
      bridge_status: 'done',
      updated_at: new Date().toISOString(),
    }).eq('id', withdrawal.id);

    if (withdrawal.batch_id) {
      this.logger.log(`${W} step 3/3 — checking if all batch bridges done before MagicBlock`);
      await this.tryCompleteBatch(withdrawal.batch_id, withdrawal);
    } else {
      this.logger.log(`${W} step 3/3 — triggering MagicBlock private transfer`);
      await this.doMagicBlockTransfer(withdrawal, withdrawal.amount_usdc);
    }
  }

  private async tryCompleteBatch(batchId: string, anyWithdrawal: any): Promise<void> {
    const db = this.supabase.getClient();
    const B = `[Batch ${batchId.slice(0, 8)}]`;

    const { data: allInBatch } = await db
      .from('lottery_withdrawals')
      .select('id, bridge_status, amount_usdc, status')
      .eq('batch_id', batchId);

    if (!allInBatch?.length) return;

    // A row is "settled" once its bridge is done, it was folded into the lead ('consolidated'),
    // it's already complete, OR it failed (a failed row will never bridge, so waiting on it would
    // stall the batch forever — exclude it). Only non-failed rows count toward the burner total.
    const settledBridge = (s: string | null) => s === 'done' || s === 'consolidated';
    const pending = allInBatch.filter(w => !settledBridge(w.bridge_status) && w.status !== 'complete' && w.status !== 'failed');
    const settled = allInBatch.length - pending.length;
    if (pending.length > 0) {
      this.logger.log(`${B} ${settled}/${allInBatch.length} legs settled — ${pending.length} still pending, waiting`);
      return;
    }

    const totalUsdc = allInBatch
      .filter(w => w.status !== 'failed')
      .reduce((sum, w) => sum + parseFloat(w.amount_usdc ?? '0'), 0);
    this.logger.log(`${B} ALL bridges done (${allInBatch.length}/${allInBatch.length}) — total=${totalUsdc} USDC → MagicBlock private transfer`);
    await this.doMagicBlockTransfer(anyWithdrawal, totalUsdc, batchId);
  }

  /** MagicBlock private transfer from burner → user's Loofta balance. Shared by single and batch. */
  private async doMagicBlockTransfer(withdrawal: any, amountUsdc: number, batchId?: string): Promise<void> {
    const db = this.supabase.getClient();
    const W = batchId ? `[Batch ${batchId.slice(0, 8)}]` : `[Withdrawal ${withdrawal.id.slice(0, 8)}]`;

    // Atomic claim: checkLifiWithdrawal (fired per-bridge-leg completion) and the separate
    // magicblockRetries sweep in processPendingWithdrawalsInner can both decide to fire this for
    // the same batch/withdrawal around the same moment — without a claim, both drain the same
    // burner: the first send succeeds, the second's simulation fails with "insufficient funds".
    // Two sequential single-condition updates (not `.or()`) — this project's PostgREST throws a
    // spurious "column does not exist" for PATCH requests whose filter uses `or=(...)`.
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    let claimedRows: { id: string }[] | null = null;
    {
      let q = db.from('lottery_withdrawals')
        .update({ magicblock_claimed_at: new Date().toISOString() })
        .eq('status', 'processing')
        .is('magicblock_claimed_at', null);
      q = batchId ? q.eq('batch_id', batchId) : q.eq('id', withdrawal.id);
      const { data, error } = await q.select('id');
      if (error) throw new Error(`MagicBlock claim failed: ${error.message}`);
      claimedRows = data;
    }
    if (!claimedRows?.length) {
      let q = db.from('lottery_withdrawals')
        .update({ magicblock_claimed_at: new Date().toISOString() })
        .eq('status', 'processing')
        .lt('magicblock_claimed_at', staleBefore);
      q = batchId ? q.eq('batch_id', batchId) : q.eq('id', withdrawal.id);
      const { data, error } = await q.select('id');
      if (error) throw new Error(`MagicBlock claim (stale-retry) failed: ${error.message}`);
      claimedRows = data;
    }
    if (!claimedRows?.length) {
      this.logger.log(`${W} MagicBlock transfer already claimed by a concurrent run — skipping`);
      return;
    }

    const burnerBalance = await this.getBurnerUsdcBalance(withdrawal.withdrawal_burner_sol_address);
    if (burnerBalance === 0n) {
      this.logger.warn(`${W} step 3/3: burner balance 0 — bridge may still be settling, will retry next cron`);
      return;
    }

    const burnerKey = this.decryptKey(withdrawal.withdrawal_burner_sol_key_enc, withdrawal.withdrawal_burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);
    const cluster = this.getSolanaCluster();

    // Reserve MagicBlock's relay fee at the LIVE 0.002-SOL price (not a stale flat $0.20). A small
    // 15% safety pad absorbs SOL-price movement between this reservation and MagicBlock building the
    // tx; over-reserving only leaves recoverable dust, under-reserving fails the transfer.
    const relayFeeUsdc = (await this.magicblockRelayFeeUsdc()) * 1.15;
    const relayFeeUnits = Math.round(relayFeeUsdc * 1_000_000);
    // A plain (non-exactOut) request just moves `amount` in full with no internal gross-up, so
    // this used to send burnerBalance-minus-flat-fee directly — reasonable in principle, but it
    // silently assumed MAGICBLOCK_GAS_USDC ($0.20) always covers MagicBlock's real relay cost.
    // Real incident: that assumption drifted and the relay rejected the request as underfunded
    // (Program error: insufficient funds) even though the burner plainly had the money.
    // exactOut: true is the documented-correct pattern (see magicblock-private-transfer.ts) —
    // MagicBlock grosses up the sender's debit internally to cover its own fee, so we only need
    // to reserve for the *separate* flat SOL-gas relay instruction, then invert
    // estimateMagicblockGrossUp to find the largest net amount whose internal gross-up still
    // fits what's left of the burner.
    const availableForTransfer = Number(burnerBalance) - relayFeeUnits;
    const transferAmount = availableForTransfer > 0
      ? Math.floor((availableForTransfer - 1) * (10_000 - MAGICBLOCK_VOLUME_FEE_BPS) / 10_000)
      : 0;

    this.logger.log(`${W} step 3/3 MagicBlock: burner ${withdrawal.withdrawal_burner_sol_address.slice(0, 8)}… balance=${burnerBalance} → transferAmount(net, exactOut)=${transferAmount} → ${withdrawal.destination_address}`);

    let sig: string;

    // MagicBlock gasless requires ≥5 USDC. For smaller amounts fall back to a direct SPL transfer.
    const MAGICBLOCK_GASLESS_MIN_UNITS = 5_000_000;
    const canUseGasless = transferAmount >= MAGICBLOCK_GASLESS_MIN_UNITS;

    if (canUseGasless) {
      let txResponse: Awaited<ReturnType<typeof requestMagicblockPrivateTransfer>>;
      try {
        txResponse = await requestMagicblockPrivateTransfer({
          from: withdrawal.withdrawal_burner_sol_address,
          to: withdrawal.destination_address,
          mint: USDC_MINT.toBase58(),
          amount: transferAmount,
          cluster,
          gasless: true,
          exactOut: true,
        });
      } catch (err: any) {
        if (String(err?.message).includes('delegated to another validator')) {
          this.logger.warn(`${W} MagicBlock: burner ATA delegated — will retry next cron`);
          return;
        }
        throw err;
      }

      const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
      const conn = await this.getSolanaConnection();
      // MagicBlock may return a v0 (versioned) or legacy transaction
      let rawTx: Buffer;
      try {
        const vTx = VersionedTransaction.deserialize(txBytes);
        vTx.sign([burnerKeypair]);
        rawTx = Buffer.from(vTx.serialize());
      } catch {
        const tx = Transaction.from(txBytes);
        tx.partialSign(burnerKeypair);
        rawTx = tx.serialize() as Buffer;
      }
      sig = await conn.sendRawTransaction(rawTx);
      this.logger.log(`${W} MagicBlock private tx: ${sig}`);

      // sendRawTransaction only means the RPC accepted it for broadcast — confirmTransaction
      // resolving normally does NOT mean the transaction succeeded, it only means the target
      // commitment was reached; a reverted tx confirms with `.value.err` set and no throw. A
      // real incident: a losing concurrent attempt's failed tx got recorded as 'complete'
      // because this check didn't exist, while the actual successful transfer went unrecorded.
      const confirmation = await conn.confirmTransaction(sig, 'confirmed');
      if (confirmation.value.err) {
        throw new Error(`MagicBlock transfer failed on-chain (${sig}): ${JSON.stringify(confirmation.value.err)}`);
      }
    } else {
      // Amount below MagicBlock minimum ($5) — send directly via SPL transfer (fee payer covers gas)
      this.logger.log(`${W} balance ${(Number(burnerBalance) / 1e6).toFixed(6)} USDC < MagicBlock gasless minimum, using direct SPL transfer`);
      sig = await this.sendUsdcFromBurner(burnerKeypair, withdrawal.destination_address, burnerBalance);
    }

    this.logger.log(`${W} step 3/3 complete: sig=${sig}`);
    // The actual USDC that landed in the user's wallet — exactOut guarantees the gasless path
    // delivers exactly `transferAmount`; the direct-SPL fallback sends the full burner balance.
    const deliveredUsdc = (canUseGasless ? transferAmount : Number(burnerBalance)) / 1_000_000;

    const updateData = { status: 'complete', magicblock_tx_hash: sig, bridge_status: 'done', updated_at: new Date().toISOString() };
    let ticketIds: string[] = [];
    if (batchId) {
      // Only settle rows that actually contributed to the burner — a 'failed' row (e.g. a claim
      // that reverted) must NOT be flipped to complete, and its ticket must NOT be marked
      // withdrawn (it never got paid).
      await db.from('lottery_withdrawals').update(updateData).eq('batch_id', batchId).neq('status', 'failed');
      const { data: batchRows } = await db.from('lottery_withdrawals').select('ticket_id').eq('batch_id', batchId).neq('status', 'failed');
      ticketIds = (batchRows ?? []).map((r: any) => r.ticket_id).filter(Boolean);
    } else {
      await db.from('lottery_withdrawals').update(updateData).eq('id', withdrawal.id);
      if (withdrawal.ticket_id) ticketIds = [withdrawal.ticket_id];
    }

    // Reconcile each ticket's displayed win amount with what was actually delivered — the
    // mid-pipeline Base-side correction in processLifiWithdrawal doesn't account for the
    // MagicBlock relay fee, so without this the History tab still overstates the real payout by
    // that fee. Prorate the real delivered total across tickets by their current recorded share
    // (keeps relative amounts sensible for a batch) rather than guessing a per-ticket split.
    if (ticketIds.length) {
      const { data: ticketsForPayout } = await db
        .from('lottery_tickets')
        .select('id, win_amount_usdc')
        .in('id', ticketIds);
      const rows = ticketsForPayout ?? [];
      const priorTotal = rows.reduce((sum: number, t: any) => sum + (t.win_amount_usdc ?? 0), 0);

      for (const t of rows) {
        const share = priorTotal > 0 ? (t.win_amount_usdc ?? 0) / priorTotal : 1 / rows.length;
        const finalAmount = parseFloat((deliveredUsdc * share).toFixed(6));
        await db.from('lottery_tickets')
          .update({ status: 'withdrawn', win_amount_usdc: finalAmount, updated_at: new Date().toISOString() })
          .eq('id', t.id);
        // Also stamp the withdrawal row with the actually-delivered share so the client can show
        // "you received $X" (the real net), not the gross win it optimistically displayed at redeem.
        const rowUpdate = db.from('lottery_withdrawals')
          .update({ amount_usdc: finalAmount, updated_at: new Date().toISOString() });
        await (batchId
          ? rowUpdate.eq('batch_id', batchId).eq('ticket_id', t.id)
          : rowUpdate.eq('id', withdrawal.id));
      }
      this.logger.log(`${W} marked ${ticketIds.length} ticket(s) withdrawn, reconciled to actual delivered total $${deliveredUsdc.toFixed(6)}`);
    }
  }

  /** Legacy NEAR Intents completion — kept for existing withdrawal records in DB. */
  private async tryCompleteNearWithdrawal(withdrawal: any): Promise<void> {
    const status = await this.nearIntents.getExecutionStatus(withdrawal.bridge_deposit_address);
    const s = (status as any)?.status ?? (status as any)?.Status ?? '';
    if (!['SUCCESS', 'COMPLETED'].includes(String(s).toUpperCase())) return;
    await this.doMagicBlockTransfer(withdrawal, withdrawal.amount_usdc);
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  private mapTicketSummary(t: any): LotteryTicketSummary {
    return {
      id: t.id,
      status: t.status,
      numTickets: t.num_tickets,
      costUsdc: parseFloat(t.cost_usdc),
      roundId: t.round_id,
      drawTime: t.draw_time,
      winAmountUsdc: t.win_amount_usdc ? parseFloat(t.win_amount_usdc) : null,
      winTier: t.win_tier,
      createdAt: t.created_at,
      depositAddress: ['pending_send', 'sent', 'bridging'].includes(t.status) ? (t.bridge_deposit_address ?? null) : null,
      bridgeStatus: t.bridge_status ?? null,
      bridgeExpiresAt: t.bridge_expires_at ?? null,
      ticketNumbers: t.ticket_numbers ?? null,
      winningNumbers: t.winning_numbers ?? null,
    };
  }

  /** Paginated ticket history (finished tickets only), newest first. Always user-scoped. */
  async getTicketHistory(userId: string, offset: number, limit: number): Promise<{ tickets: LotteryTicketSummary[]; total: number }> {
    const db = this.supabase.getClient();
    const { data, count } = await db
      .from('lottery_tickets')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .in('status', ['won', 'lost', 'failed', 'withdrawn'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return { tickets: (data ?? []).map(t => this.mapTicketSummary(t)), total: count ?? 0 };
  }

  async getDashboard(userId: string): Promise<LotteryDashboard> {
    const db = this.supabase.getClient();
    const [ticketsRes, withdrawalsRes] = await Promise.all([
      db.from('lottery_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
      db.from('lottery_withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    ]);

    const tickets: LotteryTicketSummary[] = (ticketsRes.data ?? [])
      .filter((t: any) => !t.deleted_at)
      .map((t: any) => this.mapTicketSummary(t));

    const withdrawals: LotteryWithdrawalSummary[] = (withdrawalsRes.data ?? []).map((w: any) => ({
      id: w.id,
      ticketId: w.ticket_id,
      route: w.route,
      destinationAddress: w.destination_address,
      amountUsdc: parseFloat(w.amount_usdc),
      status: w.status,
      createdAt: w.created_at,
    }));

    const activeTickets = tickets.filter(t => ['pending_send', 'sent', 'bridging', 'buying', 'active'].includes(t.status));
    const history = tickets.filter(t => ['won', 'lost', 'failed', 'withdrawn'].includes(t.status));

    const totalSpent = tickets.reduce((sum, t) => sum + t.costUsdc, 0);
    const totalWon = tickets.reduce((sum, t) => sum + (t.winAmountUsdc ?? 0), 0);

    let nextDraw = { roundId: null as string | null, drawTime: null as string | null, prizePool: null as string | null };
    try {
      const round = await this.megapot.getActiveRound();
      nextDraw = { roundId: round?.id ?? null, drawTime: round?.drawTime ?? null, prizePool: round?.prizePool ?? null };
    } catch { /* non-fatal */ }

    return {
      activeTickets,
      history,
      withdrawals,
      stats: { totalSpent, totalWon, netPnl: totalWon - totalSpent, ticketCount: tickets.length },
      nextDraw,
    };
  }

  async getTicketStatus(ticketId: string, userId: string): Promise<LotteryTicketSummary | null> {
    const db = this.supabase.getClient();
    const { data } = await db.from('lottery_tickets').select('*').eq('id', ticketId).eq('user_id', userId).single();
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      numTickets: data.num_tickets,
      costUsdc: parseFloat(data.cost_usdc),
      roundId: data.round_id,
      drawTime: data.draw_time,
      winAmountUsdc: data.win_amount_usdc ? parseFloat(data.win_amount_usdc) : null,
      winTier: data.win_tier,
      createdAt: data.created_at,
      depositAddress: ['pending_send', 'sent', 'bridging'].includes(data.status) ? (data.bridge_deposit_address ?? null) : null,
      bridgeStatus: data.bridge_status ?? null,
      bridgeExpiresAt: data.bridge_expires_at ?? null,
      ticketNumbers: data.ticket_numbers ?? null,
      winningNumbers: data.winning_numbers ?? null,
    };
  }

  /** Fast Solana RPC deposit check — called by frontend every 5s during deposit waiting */
  async checkDepositFast(ticketId: string, userId: string): Promise<{ status: string }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('id, status, bridge_deposit_address')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) return { status: 'not_found' };
    if (ticket.status !== 'pending_send') return { status: ticket.status };
    if (!ticket.bridge_deposit_address) return { status: ticket.status };

    try {
      const balance = await this.checkSolanaUsdcDeposit(ticket.bridge_deposit_address);
      if (balance > 0) {
        await db.from('lottery_tickets').update({
          status: 'bridging',
          bridge_status: 'DEPOSITED',
          updated_at: new Date().toISOString(),
        }).eq('id', ticket.id);
        this.logger.log(`Ticket ${ticket.id}: fast Solana check detected ${balance} USDC — moved to bridging`);
        return { status: 'bridging' };
      }
    } catch (e: any) {
      this.logger.warn(`checkDepositFast ${ticketId}: Solana check failed — ${e.message}`);
    }

    return { status: ticket.status };
  }

  async cancelTicket(ticketId: string, userId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('id, status')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found');

    if (ticket.status === 'failed') {
      // Soft-delete dismissed failed tickets
      await db.from('lottery_tickets')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', ticketId)
        .eq('user_id', userId);
      return;
    }

    // Only pending_send is cancellable: once the MagicBlock tx is signed ('sent') or the bridge
    // is in flight ('bridging'), the money WILL arrive somewhere — cancelling would orphan it
    // on a dead ticket. Those states must resolve via the crons or an explicit rescue instead.
    const { data, error } = await db
      .from('lottery_tickets')
      .update({ status: 'failed', bridge_status: 'CANCELLED' })
      .eq('id', ticketId)
      .eq('user_id', userId)
      .eq('status', 'pending_send')
      .select('id')
      .single();
    if (error || !data) throw new BadRequestException('Ticket cannot be cancelled — funds are already in transit. Use rescue instead if it looks stuck.');
  }

  async retryTicket(ticketId: string, userId: string): Promise<{ ok: boolean }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('id, status, bridge_status')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found');
    if (!['failed', 'buying'].includes(ticket.status)) throw new BadRequestException('Only failed or stuck buying tickets can be retried');
    if (['CANCELLED', 'RESCUED'].includes(ticket.bridge_status)) {
      throw new BadRequestException('Cancelled or rescued tickets cannot be retried');
    }

    await db.from('lottery_tickets').update({
      status: 'buying',
      updated_at: new Date().toISOString(),
    }).eq('id', ticketId).eq('user_id', userId);

    this.logger.log(`Ticket ${ticketId}: retry queued by user ${userId}`);
    return { ok: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private getSolanaCluster(): 'mainnet' | 'devnet' | 'localhost' {
    const cluster = this.config.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER', 'devnet');
    if (cluster === 'mainnet-beta' || cluster === 'mainnet') return 'mainnet';
    if (cluster === 'localhost') return 'localhost';
    return 'devnet';
  }

  private async getSolanaConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    return new Connection(rpc, 'confirmed');
  }

  private decryptKey(enc: string, context: string): Buffer {
    return this.enc.decrypt(enc, context);
  }

  /**
   * Builds the upfront fee-collection transaction: a plain (non-private) USDC transfer from
   * the user's own wallet to the fee wallet, sponsored (fee wallet pays gas) but requiring the
   * user's signature since they're the token authority. Returned unsigned-by-user for the
   * frontend to sign and send BEFORE the MagicBlock transfer — we can't append this transfer as
   * an instruction on MagicBlock's own pre-built transaction, so it has to be its own tx.
   */
  private async buildFeeCollectionTx(
    fromAddress: string,
    amountUsdc: number,
  ): Promise<{ transactionBase64: string; feeWalletAddress: string }> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    const feePayerKeypair = Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
    const feeWalletAddress = feePayerKeypair.publicKey.toBase58();

    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(fromAddress);
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromPubkey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, feePayerKeypair.publicKey);

    const instructions = [];
    try {
      await getAccount(conn, toAta);
    } catch {
      instructions.push(createAssociatedTokenAccountInstruction(feePayerKeypair.publicKey, toAta, feePayerKeypair.publicKey, USDC_MINT));
    }
    instructions.push(createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(amountUsdc * 1_000_000)));

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([feePayerKeypair]); // fee wallet partial-signs to sponsor gas; user signs client-side

    return { transactionBase64: Buffer.from(tx.serialize()).toString('base64'), feeWalletAddress };
  }

  /**
   * Sends USDC from the fee-payer wallet to `toAddress`, self-sponsoring its own gas.
   * Used to top up a burner mid-bridge if the real Li.Fi execution quote comes in short of
   * what the purchase-time estimate assumed (see tryStartBridge) — funded by the fee revenue
   * this same wallet collects on every purchase.
   */
  private async topUpFromFeeWallet(toAddress: string, amount: bigint): Promise<string> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    const feePayerKeypair = Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));

    const conn = await this.getSolanaConnection();
    const toPubkey = new PublicKey(toAddress);
    const sourceAccounts = await conn.getParsedTokenAccountsByOwner(feePayerKeypair.publicKey, { programId: TOKEN_PROGRAM_ID });
    const usdcMint = USDC_MINT.toBase58();
    const usdcAccount = sourceAccounts.value.find(a => (a.account.data as any).parsed?.info?.mint === usdcMint);
    if (!usdcAccount) throw new Error('Fee wallet has no USDC token account — insufficient reserve to top up');
    const feeWalletAta = new PublicKey(usdcAccount.pubkey);

    const toAta = await getAssociatedTokenAddress(USDC_MINT, toPubkey);
    const tx = new Transaction();
    try {
      await getAccount(conn, toAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(feePayerKeypair.publicKey, toAta, toPubkey, USDC_MINT, TOKEN_PROGRAM_ID));
    }
    tx.add(createTransferInstruction(feeWalletAta, toAta, feePayerKeypair.publicKey, amount));
    tx.feePayer = feePayerKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(feePayerKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize());
    const topUpConfirmation = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (topUpConfirmation.value.err) {
      throw new Error(`topUpFromFeeWallet failed on-chain (${sig}): ${JSON.stringify(topUpConfirmation.value.err)}`);
    }
    this.logger.log(`topUpFromFeeWallet: sent ${(Number(amount) / 1_000_000).toFixed(6)} USDC → ${toAddress.slice(0, 8)}…, sig=${sig}`);
    return sig;
  }

  /**
   * Once the bridge has left the burner (bridge_status DONE) or its USDC was rescued back to
   * the user (RESCUED), the burner wallet is never used again — but it still holds leftover
   * gas SOL (~0.0009), USDC dust from quote rounding, and its USDC token account carries
   * ~0.002 SOL of reclaimable rent. Sweep all three back to the fee wallet; without this,
   * every purchase strands ~$0.24 and the flow loses money.
   */
  private sweepRunning = false;

  async sweepFinishedBurners(): Promise<void> {
    if (this.sweepRunning) return; // overlap guard — concurrent sweeps of the same burner would conflict
    this.sweepRunning = true;
    try {
      const db = this.supabase.getClient();
      const { data: tickets } = await db
        .from('lottery_tickets')
        .select('*')
        .not('burner_sol_address', 'is', null)
        .is('burner_swept_at', null)
        .in('bridge_status', ['DONE', 'RESCUED'])
        .order('created_at', { ascending: true })
        .limit(20);

      for (const ticket of tickets ?? []) {
        await this.sweepBurner(ticket).catch(e =>
          this.logger.warn(`sweepBurner ${ticket.id}: ${e.message}`),
        );
      }
    } finally {
      this.sweepRunning = false;
    }
  }

  private async sweepBurner(ticket: any): Promise<void> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    const feePayerKeypair = Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
    const burnerKey = this.decryptKey(ticket.burner_sol_key_enc, ticket.burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);

    const conn = await this.getSolanaConnection();
    const db = this.supabase.getClient();

    const [lamports, tokenAccounts] = await Promise.all([
      conn.getBalance(burnerKeypair.publicKey),
      conn.getParsedTokenAccountsByOwner(burnerKeypair.publicKey, { programId: TOKEN_PROGRAM_ID }),
    ]);

    const tx = new Transaction();
    const usdcMint = USDC_MINT.toBase58();
    let usdcSwept = 0n;
    let feeWalletAta: PublicKey | null = null;

    for (const a of tokenAccounts.value) {
      const info = (a.account.data as any).parsed?.info;
      if (info?.mint !== usdcMint) continue; // only touch USDC accounts
      const balance = BigInt(info?.tokenAmount?.amount ?? '0');
      if (balance > 0n) {
        if (!feeWalletAta) {
          feeWalletAta = await getAssociatedTokenAddress(USDC_MINT, feePayerKeypair.publicKey);
          try { await getAccount(conn, feeWalletAta); } catch {
            tx.add(createAssociatedTokenAccountInstruction(
              feePayerKeypair.publicKey, feeWalletAta, feePayerKeypair.publicKey, USDC_MINT, TOKEN_PROGRAM_ID,
            ));
          }
        }
        tx.add(createTransferInstruction(new PublicKey(a.pubkey), feeWalletAta, burnerKeypair.publicKey, balance));
        usdcSwept += balance;
      }
      // Close the now-empty account — its rent lamports go to the fee wallet
      tx.add(createCloseAccountInstruction(new PublicKey(a.pubkey), feePayerKeypair.publicKey, burnerKeypair.publicKey));
    }

    // The fee payer covers the tx fee, so the burner's SOL can be swept down to zero
    if (lamports > 0) {
      tx.add(SystemProgram.transfer({
        fromPubkey: burnerKeypair.publicKey,
        toPubkey: feePayerKeypair.publicKey,
        lamports,
      }));
    }

    if (tx.instructions.length === 0) {
      await db.from('lottery_tickets').update({
        burner_swept_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', ticket.id);
      this.logger.log(`Ticket ${ticket.id}: burner ${ticket.burner_sol_address.slice(0, 8)}… already empty — marked swept`);
      return;
    }

    tx.feePayer = feePayerKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(feePayerKeypair, burnerKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize());
    const sweepConfirmation = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (sweepConfirmation.value.err) {
      throw new Error(`Burner sweep failed on-chain (${sig}): ${JSON.stringify(sweepConfirmation.value.err)}`);
    }

    await db.from('lottery_tickets').update({
      burner_swept_at: new Date().toISOString(),
      burner_sweep_tx_hash: sig,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    this.logger.log(
      `Ticket ${ticket.id}: burner swept — ${(lamports / 1e9).toFixed(6)} SOL + ` +
      `${(Number(usdcSwept) / 1_000_000).toFixed(6)} USDC dust + token-account rent → fee wallet | tx ${sig}`,
    );
  }

  private async getBurnerUsdcBalance(address: string): Promise<bigint> {
    try {
      const conn = await this.getSolanaConnection();
      // Use programId filter (not mint) to avoid "Token mint could not be unpacked" RPC errors
      const accounts = await conn.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { programId: TOKEN_PROGRAM_ID },
      );
      const usdcMint = USDC_MINT.toBase58();
      let total = 0n;
      for (const a of accounts.value) {
        const info = (a.account.data as any).parsed?.info;
        if (info?.mint === usdcMint) {
          const raw: string | undefined = info?.tokenAmount?.amount;
          if (raw) total += BigInt(raw);
        }
      }
      this.logger.debug(`getBurnerUsdcBalance(${address}): ${total} (${accounts.value.length} token accounts)`);
      return total;
    } catch (e: any) {
      this.logger.warn(`getBurnerUsdcBalance(${address}) failed: ${e.message}`);
      return 0n;
    }
  }

  private async sendUsdcFromBurner(
    burnerKeypair: Keypair,
    toAddress: string,
    amount: bigint,
  ): Promise<string> {
    const conn = await this.getSolanaConnection();
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');

    const bs58 = await import('bs58');
    const feePayerKeypair = Keypair.fromSecretKey(bs58.default.decode(feePayerKey));
    const toPubkey = new PublicKey(toAddress);

    // Use programId filter to avoid "Token mint could not be unpacked" RPC errors
    const sourceAccounts = await conn.getParsedTokenAccountsByOwner(
      burnerKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );
    const usdcMint = USDC_MINT.toBase58();
    const usdcAccount = sourceAccounts.value.find(
      (a) => (a.account.data as any).parsed?.info?.mint === usdcMint,
    );
    if (!usdcAccount) {
      throw new Error('Burner wallet has no USDC token accounts — funds may not have arrived yet');
    }
    const burnerAta = new PublicKey(usdcAccount.pubkey);
    this.logger.log(`sendUsdcFromBurner: source ATA=${burnerAta.toBase58()} amount=${amount}`);

    const toAta = await getAssociatedTokenAddress(USDC_MINT, toPubkey);

    const tx = new Transaction();

    // Create recipient ATA if needed
    try {
      await getAccount(conn, toAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(
        feePayerKeypair.publicKey,
        toAta,
        toPubkey,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
      ));
    }

    tx.add(createTransferInstruction(burnerAta, toAta, burnerKeypair.publicKey, amount));
    tx.feePayer = feePayerKeypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(feePayerKeypair, burnerKeypair);

    const sig = await conn.sendRawTransaction(tx.serialize());
    const confirmation = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Burner transfer failed on-chain (${sig}): ${JSON.stringify(confirmation.value.err)}`);
    }
    this.logger.log(`Burner transfer complete: ${sig}, amount: ${amount}`);
    return sig;
  }

  /**
   * "Play again" — claim winnings from a won ticket and immediately reinvest
   * them into new Megapot tickets on Base. No bridge needed, no fees.
   * Returns the new ticket ID and number of tickets purchased.
   */
  async playAgain(opts: {
    ticketId: string;
    userId: string;
  }): Promise<{ newTicketId: string; numTickets: number; roundId: string | null }> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('*')
      .eq('id', opts.ticketId)
      .eq('user_id', opts.userId)
      .eq('status', 'won')
      .single();

    if (!ticket) throw new BadRequestException('Ticket not found or not in won status');
    if (!ticket.win_amount_usdc || ticket.win_amount_usdc <= 0) {
      throw new BadRequestException('No winnings to reinvest');
    }

    const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
    const companionPrivHex = `0x${companionKey.toString('hex')}` as `0x${string}`;

    // Step 1: claim winnings if not already done
    if (!ticket.claim_tx_hash) {
      const allNftIds: string[] = ticket.ticket_nft_ids ?? [];
      if (!allNftIds.length) throw new BadRequestException('No NFT IDs stored — sync ticket numbers first');

      const nftResults = await this.megapot.checkTicketResultsFromNft(allNftIds);
      const winningNftIds = nftResults.filter(r => r.winAmountUsdc > 0).map(r => BigInt(r.tokenId));
      if (!winningNftIds.length) throw new BadRequestException('No winning NFTs found — draw may not have settled yet');

      this.logger.log(`playAgain ${opts.ticketId}: claiming ${winningNftIds.length} winning NFT(s) via Rhinestone`);
      const claimTx = await this.rhinestone.claimWinnings({ companionPrivateKey: companionPrivHex, ticketNftIds: winningNftIds });
      await db.from('lottery_tickets').update({ claim_tx_hash: claimTx, updated_at: new Date().toISOString() }).eq('id', ticket.id);
      this.logger.log(`playAgain ${opts.ticketId}: claimed — tx=${claimTx}`);
    }

    // Step 2: check actual USDC balance in companion smart account
    const usdcBalance = await this.getCompanionUsdcBalance(ticket.companion_address);
    const numTickets = Math.floor(usdcBalance / TICKET_PRICE_USDC);
    if (numTickets < 1) throw new BadRequestException(`Companion balance too low to buy tickets ($${usdcBalance.toFixed(6)} USDC)`);

    // Step 3: buy new tickets using existing companion smart account — no bridge
    this.logger.log(`playAgain ${opts.ticketId}: buying ${numTickets} new ticket(s) with $${usdcBalance.toFixed(6)} USDC`);
    await this.rhinestone.buyMegapotTickets({
      companionPrivateKey: companionPrivHex,
      numTickets,
      recipient: ticket.companion_address as Address,
      sourceId: this.megapot.getSourceId(),
      referrers: this.megapot.getReferrers(),
      splits: this.megapot.getSplits(),
    });

    // Step 4: mark old ticket as withdrawn, create new active ticket record
    await db.from('lottery_tickets').update({ status: 'withdrawn', updated_at: new Date().toISOString() }).eq('id', ticket.id);

    let roundId: string | null = null, drawTime: string | null = null;
    try { const round = await this.megapot.getActiveRound(); roundId = round?.id ?? null; drawTime = round?.drawTime ?? null; } catch {}

    const { data: newTicket, error } = await db
      .from('lottery_tickets')
      .insert({
        user_id: opts.userId,
        companion_address: ticket.companion_address,
        companion_key_enc: ticket.companion_key_enc,
        num_tickets: numTickets,
        cost_usdc: numTickets * TICKET_PRICE_USDC,
        status: 'active',
        round_id: roundId,
        draw_time: drawTime,
      })
      .select('id')
      .single();

    if (error || !newTicket) throw new Error(`Failed to create new ticket record: ${error?.message}`);

    // Non-blocking: fetch new NFT numbers
    this.megapot.getTicketNumbersFromNft(ticket.companion_address as Address, roundId ?? undefined)
      .then(async ({ tokenIds, ticketNumbers }) => {
        if (!tokenIds.length) return;
        await db.from('lottery_tickets').update({
          ticket_numbers: ticketNumbers,
          ticket_nft_ids: tokenIds,
          updated_at: new Date().toISOString(),
        }).eq('id', newTicket.id);
      })
      .catch(e => this.logger.warn(`playAgain: NFT number fetch for new ticket: ${e.message}`));

    this.logger.log(`playAgain ${opts.ticketId}: done — new ticket ${newTicket.id}, ${numTickets} tickets for round ${roundId}`);
    return { newTicketId: newTicket.id, numTickets, roundId };
  }
}
