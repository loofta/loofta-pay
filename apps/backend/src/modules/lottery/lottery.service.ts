import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey, Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
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
import { LifiService } from './lifi.service';
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
    lifiBridgeFeeUsdc: number;
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
    // Gross up 1% for Li.Fi bridge fee (actual fee ~0.3–0.8% depending on route/liquidity).
    // Then gross up the bridged amount for MagicBlock's 10 BPS + gas so the burner receives the bridged amount.
    const LIFI_FEE_BPS = 100; // 1% buffer
    const bridgeUnits = Math.ceil(costUsdc * 1_000_000 * 10_000 / (10_000 - LIFI_FEE_BPS));
    const grossAmount = grossUpForMagicblockFee(bridgeUnits); // user sends this; burner receives bridgeUnits
    const magicblockFeeUsdc = parseFloat(((grossAmount - bridgeUnits) / 1_000_000 + MAGICBLOCK_GAS_USDC).toFixed(6));
    const lifiBridgeFeeUsdc = parseFloat(((bridgeUnits - costUsdc * 1_000_000) / 1_000_000).toFixed(6));
    const totalUsdc = costUsdc + magicblockFeeUsdc + lifiBridgeFeeUsdc;

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
      feeBreakdown: { ticketCostUsdc: costUsdc, magicblockFeeUsdc, lifiBridgeFeeUsdc, totalUsdc },
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

    // Li.Fi: Solana USDC (burner) → Base USDC (companion)
    const amountUsdc = Number(burnerBalance) / 1_000_000;
    const quote = await this.lifi.getSolToBaseQuote({
      fromAddress: ticket.burner_sol_address,
      toAddress: ticket.companion_address,
      amountUsdc,
    });

    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');

    const burnerKey = this.decryptKey(ticket.burner_sol_key_enc, ticket.burner_sol_address);
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

        await db.from('lottery_tickets').update({
          bridge_status: 'DONE',
          status: 'buying',
          updated_at: new Date().toISOString(),
        }).eq('id', ticket.id);
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
    // Allow up to 0.15 USDC shortfall — Li.Fi fees can be ~0.3–1% and may exceed NEAR Intents' 0.01 tolerance
    if (usdcBalance === null || usdcBalance < usdcNeeded - 0.15) {
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

        // Fetch winning numbers for this round (non-fatal)
        const winningNumbers = ticket.round_id
          ? await this.megapot.getWinningNumbersForRound(ticket.round_id)
          : null;

        // Read on-chain NFT metadata to check Tier + Win Amount post-draw
        const results = await this.megapot.checkTicketResultsFromNft(tokenIds);
        const grossWinUsdc = results.reduce((sum, r) => sum + r.winAmountUsdc, 0);
        const claimFactor = await this.megapot.getWinClaimFactor(ticket.round_id);
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
          const apiClaimFactor = await this.megapot.getWinClaimFactor(ticket.round_id);
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
    const nftClaimFactor = await this.megapot.getWinClaimFactor(ticket.round_id ?? '0');
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

    // Claim + bridge each companion wallet in parallel
    for (const w of withdrawals) {
      const ticket = tickets.find(t => t.id === w.ticket_id);
      if (ticket) {
        this.processWithdrawal(w.id, ticket).catch(e =>
          this.logger.error(`Batch withdrawal ${w.id}: ${e.message}`),
        );
      }
    }

    this.logger.log(`Batch withdrawal ${batchId}: ${tickets.length} tickets → burner ${burnerAddress}`);
    return { withdrawalIds: withdrawals.map(w => w.id), batchId };
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
        const eoaAddress = privateKeyToAccount(companionPrivHex as `0x${string}`).address;

        // Guard: if USDC is already at the companion (smart account or EOA), a prior
        // claimWinnings call succeeded but the DB write was lost (e.g. a crash). Skip
        // the claim entirely so we don't hit TokenDoesNotExist on a burned NFT.
        const [preSmartUsdc, preEoaUsdc] = await Promise.all([
          this.getCompanionUsdcBalance(ticket.companion_address).catch(() => 0),
          this.getCompanionUsdcBalance(eoaAddress).catch(() => 0),
        ]);
        const preTotalUsdc = preSmartUsdc + preEoaUsdc;

        if (preTotalUsdc >= withdrawal.amount_usdc - 0.15) {
          this.logger.log(`${W} step 1/3 skip — USDC already at companion (${preTotalUsdc.toFixed(6)} USDC), claim already happened on-chain`);
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

          let claimTx: string;
          try {
            this.logger.log(`${W} step 1/3 — attempting Rhinestone sponsored claim (smart account=${ticket.companion_address})`);
            claimTx = await this.rhinestone.claimWinnings({
              companionPrivateKey: companionPrivHex as `0x${string}`,
              ticketNftIds: winningNftIds,
            });
            this.logger.log(`${W} step 1/3 done — Rhinestone claim ok, claimTx=${claimTx}`);
          } catch (rhinestoneErr: any) {
            // Fall back: EOA direct call (needs BASE_FUNDER_PRIVATE_KEY for gas)
            this.logger.warn(`${W} step 1/3 — Rhinestone failed (${rhinestoneErr.message?.slice(0, 120)}), falling back to EOA ${eoaAddress}`);
            await this.megapot.ensureGas(eoaAddress);
            claimTx = await this.megapot.claimWinnings({
              companionPrivateKey: companionPrivHex,
              ticketNftIds: winningNftIds,
            });
            this.logger.log(`${W} step 1/3 done — EOA claim ok, claimTx=${claimTx} (USDC at EOA ${eoaAddress})`);
          }

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

    // Determine where the USDC actually is after claimWinnings.
    // If Rhinestone claim succeeded → USDC is at smart account (companion_address).
    // If EOA fallback was used → USDC is at the EOA.
    const eoaAddress = privateKeyToAccount(companionPrivHex as `0x${string}`).address;
    const [smartAcctUsdc, eoaUsdc] = await Promise.all([
      this.getCompanionUsdcBalance(ticket.companion_address).catch(() => null),
      this.getCompanionUsdcBalance(eoaAddress).catch(() => null),
    ]);
    this.logger.log(`${W} Li.Fi: USDC check — smartAcct=${ticket.companion_address}:${smartAcctUsdc ?? '?'} | EOA=${eoaAddress}:${eoaUsdc ?? '?'}`);

    const useEoa = (eoaUsdc ?? 0) >= withdrawal.amount_usdc - 0.15 &&
                  (smartAcctUsdc ?? 0) < withdrawal.amount_usdc - 0.15;
    const fromAddress = useEoa ? eoaAddress : ticket.companion_address as string;

    // Use actual on-chain balance, not the recorded win amount — they can differ because:
    // 1. NFT metadata "Win Amount" is gross; Megapot applies a ~10% protocol fee on payout
    // 2. Small USDC leftover from the buy buffer may already be at the companion
    const actualUsdc = useEoa ? (eoaUsdc ?? withdrawal.amount_usdc) : (smartAcctUsdc ?? withdrawal.amount_usdc);
    const bridgeAmount = Math.min(actualUsdc, withdrawal.amount_usdc);

    // Update win_amount_usdc to the actual Megapot payout so the UI shows the correct amount
    // (NFT metadata can overstate by ~10% due to Megapot's protocol fee)
    if (bridgeAmount < withdrawal.amount_usdc - 0.05) {
      await db.from('lottery_tickets')
        .update({ win_amount_usdc: bridgeAmount, updated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      this.logger.log(`${W} updated win_amount_usdc: ${withdrawal.amount_usdc.toFixed(6)} (NFT) → ${bridgeAmount.toFixed(6)} (actual)`);
    }

    this.logger.log(`${W} Li.Fi: bridging from ${useEoa ? 'EOA' : 'smart account'} (${fromAddress.slice(0, 10)}…) → burner=${burnerAddress.slice(0, 8)}… amount=${bridgeAmount.toFixed(6)} USDC`);
    const quote = await this.lifi.getBaseToSolQuote({
      fromAddress,
      toAddress: burnerAddress,
      amountUsdc: bridgeAmount,
    });
    const feeUsd = this.lifi.feeFromQuote(quote);
    const receiveUsdc = parseFloat(quote.estimate.toAmountMin) / 1_000_000;
    this.logger.log(`${W} Li.Fi: quote via ${quote.tool} — send ${bridgeAmount.toFixed(6)} USDC, receive min ${receiveUsdc.toFixed(4)} USDC, fee ~$${feeUsd.toFixed(4)}`);

    let txHash: string;
    if (useEoa) {
      // EOA owns the USDC — fund gas and execute directly (no Rhinestone)
      this.logger.log(`${W} Li.Fi: EOA path — ensuring gas then executing directly`);
      await this.megapot.ensureGas(eoaAddress);
      txHash = await this.lifi.executeEvmQuote({ companionPrivateKey: companionPrivHex, quote });
      this.logger.log(`${W} Li.Fi: EOA swap submitted tx=${txHash}`);
    } else {
      // Smart account owns the USDC — use Rhinestone sponsored execution
      this.logger.log(`${W} Li.Fi: smart account path — executing via Rhinestone (sponsored gas)`);
      txHash = await this.rhinestone.executeLifiSwap({
        companionPrivateKey: companionPrivHex as `0x${string}`,
        approvalAddress: quote.estimate.approvalAddress as Address | undefined,
        fromAmountRaw: BigInt(quote.estimate.fromAmount),
        swapTo: quote.transactionRequest.to as Address,
        swapData: quote.transactionRequest.data as `0x${string}`,
        swapValue: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : 0n,
        toChainAddress: burnerAddress,
      });
      this.logger.log(`${W} Li.Fi: Rhinestone swap submitted tx=${txHash}`);
    }

    await db.from('lottery_withdrawals').update({
      lifi_tx_hash: txHash,
      lifi_step_tool: quote.tool,
      bridge_status: 'pending',
      updated_at: new Date().toISOString(),
    }).eq('id', withdrawalId);

    this.logger.log(`${W} Li.Fi bridge submitted — tool=${quote.tool} tx=${txHash} → waiting for DONE (polls every cron tick)`);
  }

  /** Cron: check pending Li.Fi bridges → trigger MagicBlock when done. */
  async processPendingWithdrawals(): Promise<void> {
    const db = this.supabase.getClient();

    // Li.Fi based withdrawals (new): bridge in-flight
    const { data: lifiWithdrawals } = await db
      .from('lottery_withdrawals')
      .select('*')
      .eq('route', 'solana_private')
      .eq('status', 'processing')
      .not('lifi_tx_hash', 'is', null)
      .neq('bridge_status', 'done');

    this.logger.log(`processPendingWithdrawals: ${lifiWithdrawals?.length ?? 0} Li.Fi in-flight`);

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

    const pending = allInBatch.filter(w => w.bridge_status !== 'done' && w.status !== 'complete');
    const done = allInBatch.length - pending.length;
    if (pending.length > 0) {
      this.logger.log(`${B} ${done}/${allInBatch.length} bridges done — ${pending.length} still pending, waiting`);
      return;
    }

    const totalUsdc = allInBatch.reduce((sum, w) => sum + parseFloat(w.amount_usdc ?? '0'), 0);
    this.logger.log(`${B} ALL bridges done (${allInBatch.length}/${allInBatch.length}) — total=${totalUsdc} USDC → MagicBlock private transfer`);
    await this.doMagicBlockTransfer(anyWithdrawal, totalUsdc, batchId);
  }

  /** MagicBlock private transfer from burner → user's Loofta balance. Shared by single and batch. */
  private async doMagicBlockTransfer(withdrawal: any, amountUsdc: number, batchId?: string): Promise<void> {
    const db = this.supabase.getClient();
    const W = batchId ? `[Batch ${batchId.slice(0, 8)}]` : `[Withdrawal ${withdrawal.id.slice(0, 8)}]`;

    const burnerBalance = await this.getBurnerUsdcBalance(withdrawal.withdrawal_burner_sol_address);
    if (burnerBalance === 0n) {
      this.logger.warn(`${W} step 3/3: burner balance 0 — bridge may still be settling, will retry next cron`);
      return;
    }

    const burnerKey = this.decryptKey(withdrawal.withdrawal_burner_sol_key_enc, withdrawal.withdrawal_burner_sol_address);
    const burnerKeypair = Keypair.fromSecretKey(burnerKey);
    const cluster = this.getSolanaCluster();

    const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);
    const transferAmount = Number(burnerBalance) - relayFeeUnits;

    this.logger.log(`${W} step 3/3 MagicBlock: burner ${withdrawal.withdrawal_burner_sol_address.slice(0, 8)}… balance=${burnerBalance} → transferAmount=${transferAmount} → ${withdrawal.destination_address}`);

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
    } else {
      // Amount below MagicBlock minimum ($5) — send directly via SPL transfer (fee payer covers gas)
      this.logger.log(`${W} balance ${(Number(burnerBalance) / 1e6).toFixed(6)} USDC < MagicBlock gasless minimum, using direct SPL transfer`);
      sig = await this.sendUsdcFromBurner(burnerKeypair, withdrawal.destination_address, burnerBalance);
    }

    this.logger.log(`${W} step 3/3 complete: sig=${sig}`);
    const updateData = { status: 'complete', magicblock_tx_hash: sig, bridge_status: 'done', updated_at: new Date().toISOString() };
    let ticketIds: string[] = [];
    if (batchId) {
      await db.from('lottery_withdrawals').update(updateData).eq('batch_id', batchId);
      // Collect ticket IDs for the entire batch so we can mark each ticket withdrawn
      const { data: batchRows } = await db.from('lottery_withdrawals').select('ticket_id').eq('batch_id', batchId);
      ticketIds = (batchRows ?? []).map((r: any) => r.ticket_id).filter(Boolean);
    } else {
      await db.from('lottery_withdrawals').update(updateData).eq('id', withdrawal.id);
      if (withdrawal.ticket_id) ticketIds = [withdrawal.ticket_id];
    }

    // Mark each associated ticket as withdrawn so it disappears from the redeem UI
    if (ticketIds.length) {
      await db.from('lottery_tickets')
        .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
        .in('id', ticketIds);
      this.logger.log(`${W} marked ${ticketIds.length} ticket(s) withdrawn`);
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
      winningNumbers: t.winning_numbers ?? null,
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
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    this.logger.log(`Burner transfer complete: ${sig}, amount: ${amount}`);
    return sig;
  }
}
