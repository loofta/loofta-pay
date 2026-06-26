import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey, Connection, Transaction } from '@solana/web3.js';
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
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
import { requestMagicblockPrivateTransfer, grossUpForMagicblockFee, MAGICBLOCK_GAS_USDC } from '@/common/magicblock-private-transfer';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TICKET_PRICE_USDC = 1;

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
  txBase64: string;
  requiredSigners: string[];
  feeBreakdown: {
    ticketCostUsdc: number;
    magicblockFeeUsdc: number;
    nearIntentsFeeUsdc: number;
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
  ) {}

  // ─── Purchase initiation ───────────────────────────────────────────────────

  async initiatePurchase(opts: {
    userId: string;
    numTickets: number;
    userSolanaAddress: string;
  }): Promise<InitiatePurchaseResult> {
    const { userId, numTickets, userSolanaAddress } = opts;
    if (numTickets < 5 || numTickets > 50) throw new BadRequestException('Minimum 5 tickets for private purchase');

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
    // Gross up for NEAR Intents bridge fee (~0.2%) so companion receives full cost_usdc after bridging.
    // Then gross up the bridged amount for MagicBlock's 10 BPS + gas so the burner receives the bridged amount.
    const NEAR_INTENTS_FEE_BPS = 20; // 0.2% buffer — observed fee is ~0.16%
    const bridgeUnits = Math.ceil(costUsdc * 1_000_000 * 10_000 / (10_000 - NEAR_INTENTS_FEE_BPS));
    const grossAmount = grossUpForMagicblockFee(bridgeUnits); // user sends this; burner receives bridgeUnits
    const magicblockFeeUsdc = parseFloat(((grossAmount - bridgeUnits) / 1_000_000 + MAGICBLOCK_GAS_USDC).toFixed(6));
    const nearIntentsFeeUsdc = parseFloat(((bridgeUnits - costUsdc * 1_000_000) / 1_000_000).toFixed(6));
    const totalUsdc = costUsdc + magicblockFeeUsdc + nearIntentsFeeUsdc;

    // 4. Build MagicBlock private transfer: user → burner
    const cluster = this.getSolanaCluster();
    let txResponse: Awaited<ReturnType<typeof requestMagicblockPrivateTransfer>>;
    try {
      txResponse = await requestMagicblockPrivateTransfer({
        from: userSolanaAddress,
        to: burnerAddress,
        mint: USDC_MINT.toBase58(),
        amount: grossAmount,
        cluster,
        gasless: true,
        minDelayMs: 3_000,
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

    // 5. Store ticket in DB
    const db = this.supabase.getClient();
    const { data: ticket, error } = await db
      .from('lottery_tickets')
      .insert({
        user_id: userId,
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
      txBase64: txResponse.transactionBase64,
      requiredSigners: txResponse.requiredSigners,
      feeBreakdown: { ticketCostUsdc: costUsdc, magicblockFeeUsdc, nearIntentsFeeUsdc, totalUsdc },
    };
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

  // ─── Public (non-private) purchase ────────────────────────────────────────

  async initiatePublicPurchase(opts: {
    userId: string;
    numTickets: number;
  }): Promise<InitiatePublicPurchaseResult> {
    const { userId, numTickets } = opts;
    if (numTickets < 1 || numTickets > 500) throw new BadRequestException('1–500 tickets per public purchase');

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
  async processSentTickets(): Promise<void> {
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
  }

  private async tryStartBridge(ticket: any): Promise<void> {
    const burnerBalance = await this.getBurnerUsdcBalance(ticket.burner_sol_address);
    const expectedUnits = BigInt(Math.round(ticket.cost_usdc * 1_000_000));
    if (burnerBalance < expectedUnits) {
      this.logger.log(`Ticket ${ticket.id}: burner not yet funded (${burnerBalance} < ${expectedUnits})`);
      return;
    }

    // NEAR Intents: USDC (Solana) → USDC (Base) → companion (no app fee so companion gets exact cost_usdc)
    const [solUsdcId, baseUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
    ]);

    // Quote for the full burner balance (includes NEAR Intents fee buffer), not just cost_usdc.
    const amountIn = (Number(burnerBalance) / 1_000_000).toString();
    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: solUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      toToken: { tokenId: baseUsdcId, chain: 'base', symbol: 'USDC', decimals: 6 },
      amountIn,
      skipAppFees: true,
      recipient: ticket.companion_address,
      refundAddress: ticket.burner_sol_address,
    });

    if (!quote.depositAddress) {
      this.logger.warn(`Ticket ${ticket.id}: NEAR Intents quote failed`);
      return;
    }

    // Send USDC from burner to NEAR Intents deposit address
    const burnerKey = this.decryptKey(ticket.burner_sol_key_enc, ticket.burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);
    await this.sendUsdcFromBurner(burnerKeypair, quote.depositAddress, burnerBalance);

    const db = this.supabase.getClient();
    await db.from('lottery_tickets').update({
      status: 'bridging',
      bridge_deposit_address: quote.depositAddress,
      bridge_memo: quote.memo,
      bridge_quote_id: quote.quoteId,
      bridge_status: 'pending',
      bridge_expires_at: quote.deadline ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    this.logger.log(`Ticket ${ticket.id}: bridge started → deposit ${quote.depositAddress}`);
  }

  /** Process all tickets in 'bridging' or stuck 'buying' status: check bridge + buy */
  async processBridgingTickets(): Promise<void> {
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
  }

  private async tryBuyTickets(ticket: any): Promise<void> {
    const db = this.supabase.getClient();

    // If already in 'buying' (retry after Rhinestone failure) skip NEAR Intents check
    if (ticket.status !== 'buying') {
      if (!ticket.bridge_deposit_address) {
        this.logger.warn(`Ticket ${ticket.id}: no deposit address to poll`);
        return;
      }

      // Fast path: check Solana RPC directly — much faster than waiting for NEAR Intents
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
          status: 'failed',
          bridge_status: s,
          updated_at: new Date().toISOString(),
        }).eq('id', ticket.id);
        this.logger.warn(`Ticket ${ticket.id}: bridge ${s} — marked failed`);
        return;
      }

      // If NEAR Intents never transitions PENDING_DEPOSIT → EXPIRED (abandoned quotes),
      // fall back to local expiry check so stale tickets don't poll forever.
      if (s === 'PENDING_DEPOSIT' && ticket.bridge_expires_at && new Date(ticket.bridge_expires_at) < new Date()) {
        await db.from('lottery_tickets').update({
          status: 'failed',
          bridge_status: 'EXPIRED',
          updated_at: new Date().toISOString(),
        }).eq('id', ticket.id);
        this.logger.warn(`Ticket ${ticket.id}: deposit window expired (local) — marked failed`);
        return;
      }

      if (!isDone) {
        // If public ticket shows deposit was received, move from pending_send → bridging
        if (ticket.status === 'pending_send' && isInFlight) {
          await db.from('lottery_tickets').update({
            status: 'bridging',
            bridge_status: s,
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: deposit received (${s}), moved to bridging`);
        }
        return;
      }

      await db.from('lottery_tickets').update({ bridge_status: s, status: 'buying', updated_at: new Date().toISOString() }).eq('id', ticket.id);
      this.logger.log(`Ticket ${ticket.id}: bridge complete (${s}), moving to buying`);
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
    // Allow up to 0.01 USDC shortfall from NEAR Intents bridge protocol fees
    if (usdcBalance === null || usdcBalance < usdcNeeded - 0.01) {
      this.logger.warn(`Ticket ${ticket.id}: companion has ${usdcBalance} USDC, need ${usdcNeeded} — waiting for bridge to settle`);
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
      await db.from('lottery_tickets').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
      this.logger.error(`Ticket ${ticket.id}: private buyTickets failed: ${err.message}`);
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
          this.logger.log(`Backfill: stored ${ticketNumbers.length} numbers for ticket ${ticket.id}`);
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
      .select('id, companion_address, round_id, status')
      .eq('id', ticketId)
      .eq('user_id', userId)
      .single();

    if (!ticket?.companion_address) return { ok: false, count: 0 };

    const { tokenIds, ticketNumbers } = await this.megapot.getTicketNumbersFromNft(
      ticket.companion_address as Address,
      ticket.round_id ?? undefined,
    );

    this.logger.log(`syncTicketNumbers ${ticketId}: found ${ticketNumbers.length} NFT numbers, tokenIds=${tokenIds.slice(0, 3).join(',')}`);

    if (ticketNumbers.length > 0) {
      await db.from('lottery_tickets').update({
        ticket_numbers: ticketNumbers,
        ticket_nft_ids: tokenIds,
        updated_at: new Date().toISOString(),
      }).eq('id', ticketId);
    }

    return { ok: true, count: ticketNumbers.length };
  }

  async rescueCompanionFunds(ticketId: string, userId: string): Promise<{ ok: boolean }> {
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

    if (usdcBalance > 0) {
      await this.rhinestone.rescueUsdc({
        companionPrivateKey: companionPrivHex as `0x${string}`,
        rescueWallet: RESCUE_WALLET,
        amountUsdc: usdcBalance,
      });
      this.logger.log(`Rescue USDC complete: ${usdcBalance} USDC → ${RESCUE_WALLET}`);
    }

    await db.from('lottery_tickets').update({
      status: 'failed',
      bridge_status: 'RESCUED',
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id);

    return { ok: true };
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
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

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

        // Read on-chain NFT metadata to check Tier + Win Amount post-draw
        const results = await this.megapot.checkTicketResultsFromNft(tokenIds);
        const totalWinUsdc = results.reduce((sum, r) => sum + r.winAmountUsdc, 0);
        const topWin = results.find(r => r.winAmountUsdc > 0);

        if (totalWinUsdc > 0) {
          await db.from('lottery_tickets').update({
            status: 'won',
            win_amount_usdc: totalWinUsdc,
            win_tier: topWin?.tier ?? null,
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: WON $${totalWinUsdc} (tier ${topWin?.tier})`);
        } else {
          await db.from('lottery_tickets').update({
            status: 'lost',
            updated_at: new Date().toISOString(),
          }).eq('id', ticket.id);
          this.logger.log(`Ticket ${ticket.id}: LOST`);
        }
      } catch (err: any) {
        this.logger.warn(`checkDailyResults ticket ${ticket.id}: ${err.message}`);
      }
    }
  }

  // ─── Withdrawals ───────────────────────────────────────────────────────────

  async initiateWithdrawal(opts: {
    ticketId: string;
    userId: string;
    route: 'base' | 'solana_private';
    destinationAddress: string;
  }): Promise<{ withdrawalId: string }> {
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

    const { data: withdrawal, error: wErr } = await db
      .from('lottery_withdrawals')
      .insert({
        user_id: opts.userId,
        ticket_id: opts.ticketId,
        route: opts.route,
        destination_address: opts.destinationAddress,
        amount_usdc: ticket.win_amount_usdc,
        status: 'pending',
      })
      .select('id')
      .single();

    if (wErr || !withdrawal) throw new Error(`Failed to create withdrawal: ${wErr?.message}`);

    // Process immediately
    this.processWithdrawal(withdrawal.id, ticket).catch(e =>
      this.logger.error(`Withdrawal ${withdrawal.id} failed: ${e.message}`),
    );

    return { withdrawalId: withdrawal.id };
  }

  async processWithdrawal(withdrawalId: string, ticket: any): Promise<void> {
    const db = this.supabase.getClient();
    const { data: withdrawal } = await db.from('lottery_withdrawals').select('*').eq('id', withdrawalId).single();
    if (!withdrawal) return;

    const companionKey = this.decryptKey(ticket.companion_key_enc, ticket.companion_address);
    const companionPrivHex = `0x${companionKey.toString('hex')}`;

    try {
      // First: claim winnings on Megapot (USDC lands in companion)
      if (!ticket.claim_tx_hash) {
        const claimTx = await this.megapot.claimWinnings({
          companionPrivateKey: companionPrivHex,
          ticketNftIds: (ticket.ticket_nft_ids ?? []).map(BigInt),
        });
        await db.from('lottery_tickets').update({ claim_tx_hash: claimTx, updated_at: new Date().toISOString() }).eq('id', ticket.id);
      }

      await db.from('lottery_withdrawals').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', withdrawalId);

      if (withdrawal.route === 'base') {
        // Direct Base USDC transfer (free)
        const tx = await this.megapot.transferUsdcOnBase({
          companionPrivateKey: companionPrivHex,
          to: withdrawal.destination_address as Address,
          amountUsdc: withdrawal.amount_usdc,
        });
        await db.from('lottery_withdrawals').update({ status: 'complete', base_tx_hash: tx, updated_at: new Date().toISOString() }).eq('id', withdrawalId);
        this.logger.log(`Withdrawal ${withdrawalId}: sent to Base ${withdrawal.destination_address}, tx: ${tx}`);
      } else {
        // Private: NEAR Intents Base→Solana → fresh burner → MagicBlock → user Loofta balance
        await this.processPrivateSolanaWithdrawal(withdrawalId, withdrawal, companionPrivHex, ticket);
      }
    } catch (err: any) {
      await db.from('lottery_withdrawals').update({
        status: 'failed',
        error_message: err.message,
        updated_at: new Date().toISOString(),
      }).eq('id', withdrawalId);
      this.logger.error(`Withdrawal ${withdrawalId}: ${err.message}`);
    }
  }

  private async processPrivateSolanaWithdrawal(
    withdrawalId: string,
    withdrawal: any,
    companionPrivHex: string,
    ticket: any,
  ): Promise<void> {
    const db = this.supabase.getClient();

    // Fresh burner Solana wallet for withdrawal (breaks link)
    const withdrawalBurner = Keypair.generate();
    const withdrawalBurnerAddress = withdrawalBurner.publicKey.toBase58();
    const withdrawalBurnerKeyEnc = this.enc.encrypt(Buffer.from(withdrawalBurner.secretKey), withdrawalBurnerAddress);

    // NEAR Intents: USDC Base → USDC Solana → fresh burner
    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: NEAR_ASSET_BASE_USDC, chain: NEAR_ASSET_BASE_USDC_CHAIN, symbol: 'USDC', decimals: 6 },
      toToken: { tokenId: NEAR_ASSET_SOL_USDC, chain: NEAR_ASSET_SOL_USDC_CHAIN, symbol: 'USDC', decimals: 6 },
      amountIn: withdrawal.amount_usdc.toString(),
      recipient: withdrawalBurnerAddress,
      refundAddress: ticket.companion_address,
    });

    if (!quote.depositAddress) throw new Error('NEAR Intents bridge quote failed for withdrawal');

    // Companion sends USDC to NEAR Intents deposit address on Base
    await this.megapot.transferUsdcOnBase({
      companionPrivateKey: companionPrivHex,
      to: quote.depositAddress as Address,
      amountUsdc: withdrawal.amount_usdc,
    });

    await db.from('lottery_withdrawals').update({
      bridge_deposit_address: quote.depositAddress,
      bridge_status: 'pending',
      withdrawal_burner_sol_address: withdrawalBurnerAddress,
      withdrawal_burner_sol_key_enc: withdrawalBurnerKeyEnc,
      updated_at: new Date().toISOString(),
    }).eq('id', withdrawalId);

    this.logger.log(`Withdrawal ${withdrawalId}: bridge started → burner ${withdrawalBurnerAddress}`);
  }

  /** Process pending private Solana withdrawals (bridge done → MagicBlock private transfer) */
  async processPendingWithdrawals(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: withdrawals } = await db
      .from('lottery_withdrawals')
      .select('*, lottery_tickets(*)')
      .eq('route', 'solana_private')
      .eq('status', 'processing')
      .not('bridge_deposit_address', 'is', null);

    for (const w of withdrawals ?? []) {
      await this.tryCompletePrivateWithdrawal(w).catch(e =>
        this.logger.warn(`Withdrawal ${w.id}: ${e.message}`),
      );
    }
  }

  private async tryCompletePrivateWithdrawal(withdrawal: any): Promise<void> {
    const status = await this.nearIntents.getExecutionStatus(withdrawal.bridge_deposit_address);
    const s = (status as any)?.status ?? (status as any)?.Status ?? '';
    if (!['SUCCESS', 'COMPLETED'].includes(String(s).toUpperCase())) return;

    const db = this.supabase.getClient();
    const burnerBalance = await this.getBurnerUsdcBalance(withdrawal.withdrawal_burner_sol_address);
    if (burnerBalance === 0n) return;

    const burnerKey = this.decryptKey(withdrawal.withdrawal_burner_sol_key_enc, withdrawal.withdrawal_burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);
    const cluster = this.getSolanaCluster();

    // MagicBlock private transfer: burner → user's destination (Solana embedded wallet)
    // gasless: true — burner has 0 SOL (freshly generated), relay fee ($0.20 USDC) is taken
    // from the burner's USDC balance by MagicBlock's sponsor. We subtract it upfront so the
    // `amount` field reflects what's available for the transfer (not grossed up — burner has
    // a fixed balance, not an unlimited sender).
    const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);
    const transferAmount = Number(burnerBalance) - relayFeeUnits;
    if (transferAmount <= 0) throw new Error(`Withdrawal burner balance too low to cover relay fee: ${burnerBalance} units`);

    this.logger.log(`Withdrawal ${withdrawal.id}: sending ${transferAmount} units (burner=${burnerBalance}, relay=${relayFeeUnits})`);

    let txResponse: Awaited<ReturnType<typeof requestMagicblockPrivateTransfer>>;
    try {
      txResponse = await requestMagicblockPrivateTransfer({
        from: withdrawal.withdrawal_burner_sol_address,
        to: withdrawal.destination_address,
        mint: USDC_MINT.toBase58(),
        amount: transferAmount,
        cluster,
        gasless: true,
      });
    } catch (err: any) {
      if (String(err?.message).includes('delegated to another validator')) {
        this.logger.warn(`Withdrawal ${withdrawal.id}: burner ATA delegated to another validator — will retry on next cron run`);
        return;
      }
      throw err;
    }

    // Auto-sign with burner keypair
    const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
    const tx = Transaction.from(txBytes);
    const conn = await this.getSolanaConnection();
    tx.partialSign(burnerKeypair);

    const sig = await conn.sendRawTransaction(tx.serialize());
    this.logger.log(`Withdrawal ${withdrawal.id}: MagicBlock private tx ${sig}`);

    await db.from('lottery_withdrawals').update({
      status: 'complete',
      magicblock_tx_hash: sig,
      bridge_status: s,
      updated_at: new Date().toISOString(),
    }).eq('id', withdrawal.id);
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboard(userId: string): Promise<LotteryDashboard> {
    const db = this.supabase.getClient();
    const [ticketsRes, withdrawalsRes] = await Promise.all([
      db.from('lottery_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
      db.from('lottery_withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    ]);

    const tickets: LotteryTicketSummary[] = (ticketsRes.data ?? []).filter((t: any) => !t.deleted_at).map((t: any) => ({
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
    }));

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
    const history = tickets.filter(t => ['won', 'lost', 'failed'].includes(t.status));

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

    const { data, error } = await db
      .from('lottery_tickets')
      .update({ status: 'failed', bridge_status: 'CANCELLED' })
      .eq('id', ticketId)
      .eq('user_id', userId)
      .in('status', ['pending_send', 'sent', 'bridging'])
      .select('id')
      .single();
    if (error || !data) throw new BadRequestException('Ticket cannot be cancelled — already buying or not found');
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
  ): Promise<void> {
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
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    this.logger.log(`Burner transfer complete: ${sig}, amount: ${amount}`);
  }
}
