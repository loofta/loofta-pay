import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { guardAtaSponsorship } from '@/common/ata-sponsorship-guard';
import { tokenAccountExists } from '@/common/token-account-exists';
import { requestMagicblockPrivateTransfer, resolveMagicblockRelayFeeUsdc } from '@/common/magicblock-private-transfer';
import { CollectorCryptClient, CollectorCryptPackType, NftMetadata, OpenPackResponse, PackRarityTier } from './collectorcrypt.client';
import { GACHA_EVENTS } from './gacha.events';

// Gacha Pooled Packs is devnet-only for now (Collector Crypt pack source, treasury payments, and
// MagicBlock private payouts all target devnet) — regardless of the app-wide SOLANA_CLUSTER/
// SOLANA_RPC_URL, which stay on mainnet for the rest of the app (lottery, claims, etc.).
//
// This mint is NOT documented anywhere by Collector Crypt (their devnet docs point at the
// spl-token-faucet.com "USDC-Dev" faucet but never state the resulting mint address). Recovered
// empirically 2026-08 by calling their live dev-gacha.collectorcrypt.com/api/generatePack with a
// throwaway devnet pubkey (no API key needed on devnet — confirmed working) and decoding the
// returned unsigned transaction's SPL TransferChecked instruction, whose mint account is this
// address. Confirmed on-chain: real, initialized SPL mint, 6 decimals, mint authority is the
// mint itself and supply is astronomically large — consistent with a permissionless faucet token.
// If Collector Crypt ever rotates their devnet token, this will need re-deriving the same way.
const DEFAULT_DEVNET_USDC_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Prefix a room/bid id so verifyOnChainMemo can tell a Gacha entry/bid payment apart from any
// other memo'd transfer ever sent to the shared treasury address.
const ROOM_MEMO_PREFIX = 'gacha-room:';
const BID_MEMO_PREFIX = 'gacha-bid:';

const BID_WINDOW_MS = 4 * 60_000;
const BID_PAYMENT_GRACE_MS = 5 * 60_000;

const OPEN_POLL_INTERVAL_MS = 3_000;
const OPEN_POLL_MAX_ATTEMPTS = 20; // ~1 minute total — openPack's "waiting_for_webhook" state

// See ensureDevnetTestFunds — devnet-only test-wallet funding, covers several room joins/bids.
const DEVNET_TEST_TOPUP_USDC = 100;

export interface RoomConfigPublic {
  configKey: string;
  packType: CollectorCryptPackType;
  seats: number;
  entryUsdc: number;
  enabled: boolean;
  displayOrder: number;
}

export interface RoomSummary {
  id: string;
  configKey: string;
  packType: string;
  seats: number;
  entryUsdc: number;
  status: string;
  seatsFilled: number;
  nftMetadata: NftMetadata | null;
  rarity: PackRarityTier | null;
  buybackAmountUsdc: number | null;
  bidWindowEndsAt: string | null;
  createdAt: string;
}

@Injectable()
export class GachaService {
  private readonly logger = new Logger(GachaService.name);

  private configsCache: { configs: RoomConfigPublic[]; loadedAt: number } | null = null;
  private readonly CONFIGS_CACHE_MS = 10_000;
  private readonly usdcMint: PublicKey;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly collectorCrypt: CollectorCryptClient,
    private readonly events: EventEmitter2,
  ) {
    this.usdcMint = new PublicKey(this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || DEFAULT_DEVNET_USDC_MINT);
  }

  // ── Solana plumbing (same pattern as PackService — see pack.service.ts, EXCEPT this module is
  // forced to devnet regardless of the app-wide cluster — see DEFAULT_DEVNET_USDC_MINT comment) ──

  private async getSolanaConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_DEVNET_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://devnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.devnet.solana.com');
    return new Connection(rpc, 'confirmed');
  }

  private async getTreasuryKeypair(): Promise<Keypair> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    return Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
  }

  private async getTreasuryAddress(): Promise<string> {
    return (await this.getTreasuryKeypair()).publicKey.toBase58();
  }

  // ── Room configs (admin-editable presets — see gacha_room_configs) ───────────────────

  private async loadConfigs(): Promise<RoomConfigPublic[]> {
    if (this.configsCache && Date.now() - this.configsCache.loadedAt < this.CONFIGS_CACHE_MS) {
      return this.configsCache.configs;
    }
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('gacha_room_configs')
      .select('config_key, pack_type, seats, entry_usdc, enabled, display_order')
      .order('display_order', { ascending: true });
    if (error) throw new Error(`Failed to load gacha room configs: ${error.message}`);

    const configs: RoomConfigPublic[] = (data ?? []).map((r: any) => ({
      configKey: r.config_key,
      packType: r.pack_type,
      seats: r.seats,
      entryUsdc: Number(r.entry_usdc),
      enabled: r.enabled,
      displayOrder: r.display_order,
    }));
    this.configsCache = { configs, loadedAt: Date.now() };
    return configs;
  }

  async getPublicConfigs(): Promise<RoomConfigPublic[]> {
    const configs = await this.loadConfigs();
    return configs.filter((c) => c.enabled);
  }

  private async getConfig(configKey: string): Promise<RoomConfigPublic> {
    const configs = await this.loadConfigs();
    const found = configs.find((c) => c.configKey === configKey);
    if (!found || !found.enabled) throw new BadRequestException(`Unknown or disabled room config: ${configKey}`);
    return found;
  }

  // ── Listing ────────────────────────────────────────────────────────────────────────

  async listOpenRooms(): Promise<RoomSummary[]> {
    const db = this.supabase.getClient();
    const { data: rooms, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, pack_type, seats, entry_usdc, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at')
      .in('status', ['waiting', 'purchasing', 'opening', 'bidding', 'settling'])
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to list gacha rooms: ${error.message}`);

    const roomIds = (rooms ?? []).map((r: any) => r.id);
    const countByRoom = await this.countParticipantsByRoom(roomIds);

    return (rooms ?? []).map((r: any) => ({
      id: r.id,
      configKey: r.config_key,
      packType: r.pack_type,
      seats: r.seats,
      entryUsdc: Number(r.entry_usdc),
      status: r.status,
      seatsFilled: countByRoom[r.id] ?? 0,
      nftMetadata: r.nft_metadata,
      rarity: r.rarity,
      buybackAmountUsdc: r.buyback_amount_usdc !== null ? Number(r.buyback_amount_usdc) : null,
      bidWindowEndsAt: r.bid_window_ends_at,
      createdAt: r.created_at,
    }));
  }

  /**
   * Every room this caller has ever actually joined, regardless of status — listOpenRooms
   * deliberately excludes settled/cancelled/failed rooms (that's a lobby list, not a history),
   * which meant a settled room — precisely the moment there's a payout to claim — became
   * unreachable from the UI the instant it left listOpenRooms, unless you'd saved its URL.
   */
  async getMyRooms(userId: string): Promise<RoomSummary[]> {
    const db = this.supabase.getClient();
    const { data: myRows } = await db.from('gacha_room_participants').select('room_id').eq('user_id', userId);
    const roomIds = Array.from(new Set((myRows ?? []).map((r: any) => r.room_id)));
    if (!roomIds.length) return [];

    const { data: rooms, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, pack_type, seats, entry_usdc, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at')
      .in('id', roomIds)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to load your gacha rooms: ${error.message}`);

    const countByRoom = await this.countParticipantsByRoom(roomIds);
    return (rooms ?? []).map((r: any) => ({
      id: r.id,
      configKey: r.config_key,
      packType: r.pack_type,
      seats: r.seats,
      entryUsdc: Number(r.entry_usdc),
      status: r.status,
      seatsFilled: countByRoom[r.id] ?? 0,
      nftMetadata: r.nft_metadata,
      rarity: r.rarity,
      buybackAmountUsdc: r.buyback_amount_usdc !== null ? Number(r.buyback_amount_usdc) : null,
      bidWindowEndsAt: r.bid_window_ends_at,
      createdAt: r.created_at,
    }));
  }

  private async countParticipantsByRoom(roomIds: string[]): Promise<Record<string, number>> {
    if (!roomIds.length) return {};
    const db = this.supabase.getClient();
    const { data, error } = await db.from('gacha_room_participants').select('room_id').in('room_id', roomIds);
    if (error) throw new Error(`Failed to count gacha room participants: ${error.message}`);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) counts[row.room_id] = (counts[row.room_id] ?? 0) + 1;
    return counts;
  }

  /** Used by GachaGateway to know how many "ready" marks a room needs before it auto-opens —
   *  see the mark_ready/room:all_ready flow there. */
  async getParticipantCount(roomId: string): Promise<number> {
    const counts = await this.countParticipantsByRoom([roomId]);
    return counts[roomId] ?? 0;
  }

  /** Used by GachaGateway's pick_emoji handler — broadcasts an emoji pick by seat number, never
   *  by raw user id (seat number is already public in the room UI; a Privy user id isn't). */
  async getMySeatNumber(roomId: string, userId: string): Promise<number | null> {
    const db = this.supabase.getClient();
    const { data } = await db.from('gacha_room_participants').select('seat_number').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    return data?.seat_number ?? null;
  }

  /**
   * Powers a small balance readout on the Gacha pages — the app's general devnet/mainnet toggle
   * (store/auth.ts networkMode) doesn't help here: it's effectively retired (forced back to
   * mainnet on every rehydrate) and even when set, queries a DIFFERENT devnet USDC mint
   * (lib/solanaRpc.ts's DEVNET_USDC_MINT) than the one Gacha/Collector Crypt actually uses
   * (this.usdcMint). This is deliberately its own read path, scoped to Gacha, rather than trying
   * to fix that broader system.
   */
  async getMyDevnetUsdcBalance(userId: string): Promise<{ address: string; usdcBalance: number }> {
    const address = await this.usersService.getSolanaWalletAddress(userId);
    const conn = await this.getSolanaConnection();
    const ata = await getAssociatedTokenAddress(this.usdcMint, new PublicKey(address));
    let units = 0n;
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      units = BigInt(bal.value.amount);
    } catch { /* no ATA yet — balance is 0 */ }
    return { address, usdcBalance: Number(units) / 1_000_000 };
  }

  /** Full detail for one room regardless of status (listOpenRooms only ever returns
   *  active-lifecycle rooms) plus the caller's own participation/payout/bid state, so a single
   *  room screen can poll one endpoint through the whole lobby -> bidding -> settled flow. */
  async getRoomDetail(roomId: string, userId: string): Promise<{
    room: RoomSummary;
    myParticipant: { seatNumber: number; payoutUsdc: number | null; payoutIsPrivate: boolean | null; claimed: boolean } | null;
    bestBid: { amountUsdc: number } | null;
    pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
    participants: Array<{ seatNumber: number; username: string | null; isMe: boolean }>;
  }> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, pack_type, seats, entry_usdc, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, pending_bid_id, created_at')
      .eq('id', roomId)
      .maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');

    const counts = await this.countParticipantsByRoom([roomId]);
    const { data: mine } = await db.from('gacha_room_participants').select('seat_number, payout_usdc, payout_is_private, payout_tx_sig').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    const { data: bestBid } = await db.from('gacha_bids').select('amount_usdc').eq('room_id', roomId).order('amount_usdc', { ascending: false }).limit(1).maybeSingle();

    // Seat + username only, for the round-table UI — never the wallet or full user id, same
    // "don't leak more than the UI needs" posture as bid amounts already being anonymous.
    const { data: seatRows } = await db.from('gacha_room_participants').select('seat_number, user_id').eq('room_id', roomId).order('seat_number', { ascending: true });
    const uniqueUserIds = Array.from(new Set((seatRows ?? []).map((r: any) => r.user_id)));
    let usernameByUserId: Record<string, string | null> = {};
    if (uniqueUserIds.length) {
      const { data: users } = await db.from('app_users').select('privy_user_id, username').in('privy_user_id', uniqueUserIds);
      usernameByUserId = Object.fromEntries((users ?? []).map((u: any) => [u.privy_user_id, u.username ?? null]));
    }
    const participants = (seatRows ?? []).map((r: any) => ({
      seatNumber: r.seat_number,
      username: usernameByUserId[r.user_id] ?? null,
      isMe: r.user_id === userId,
    }));

    let pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null = null;
    if (room.pending_bid_id) {
      const { data: pb } = await db.from('gacha_bids').select('id, user_id, amount_usdc').eq('id', room.pending_bid_id).maybeSingle();
      const { data: roomRow } = await db.from('gacha_rooms').select('pending_bid_deadline').eq('id', roomId).single();
      if (pb) pendingBid = { bidId: pb.id, userId: pb.user_id, amountUsdc: Number(pb.amount_usdc), deadline: roomRow?.pending_bid_deadline };
    }

    return {
      room: {
        id: room.id, configKey: room.config_key, packType: room.pack_type, seats: room.seats, entryUsdc: Number(room.entry_usdc),
        status: room.status, seatsFilled: counts[roomId] ?? 0, nftMetadata: room.nft_metadata, rarity: room.rarity,
        buybackAmountUsdc: room.buyback_amount_usdc !== null ? Number(room.buyback_amount_usdc) : null,
        bidWindowEndsAt: room.bid_window_ends_at, createdAt: room.created_at,
      },
      myParticipant: mine ? { seatNumber: mine.seat_number, payoutUsdc: mine.payout_usdc !== null ? Number(mine.payout_usdc) : null, payoutIsPrivate: mine.payout_is_private, claimed: !!mine.payout_tx_sig } : null,
      bestBid: bestBid ? { amountUsdc: Number(bestBid.amount_usdc) } : null,
      pendingBid,
      participants,
    };
  }

  // ── Join flow ──────────────────────────────────────────────────────────────────────

  /**
   * Finds an existing `waiting` room for this config with an open seat, or creates a new one.
   * Then builds the entry-payment transfer (treasury sponsors gas + destination ATA, same as
   * PackService.buildPaymentTx) with an SPL Memo instruction encoding the room id — required
   * because, unlike Mystery Pack, many rooms share this one treasury address at once, so a
   * payment must be attributable to a specific room, not just "≥$X arrived" (see confirmJoin).
   */
  async buildJoinTx(configKey: string, userSolanaAddress: string, userId: string): Promise<{ txBase64: string | null; roomId: string; entryUsdc: number; alreadyJoined?: boolean }> {
    const cfg = await this.getConfig(configKey);

    // Without this, a user re-clicking Join for the same config (e.g. after navigating away and
    // back, before their room has filled) gets routed by findOrCreateWaitingRoom straight back
    // into the SAME room they already paid into — building and signing a genuinely NEW, real
    // payment for a seat they already hold. The second payment lands on-chain (real money moved)
    // but confirmJoin's insert then fails on the (room_id, user_id) unique constraint, so it's
    // never recorded — a real, silently-lost payment. Block it before any transaction exists.
    const db = this.supabase.getClient();
    const { data: myRoomIds } = await db.from('gacha_room_participants').select('room_id').eq('user_id', userId);
    if (myRoomIds?.length) {
      const { data: existingSeat } = await db
        .from('gacha_rooms')
        .select('id')
        .in('id', myRoomIds.map((r: any) => r.room_id))
        .eq('config_key', configKey)
        .eq('status', 'waiting')
        .maybeSingle();
      // No transaction to sign — the caller already has a seat here. Send them straight back to
      // it (alreadyJoined: true, txBase64 omitted) instead of erroring into a dead end.
      if (existingSeat) return { txBase64: null, roomId: existingSeat.id, entryUsdc: cfg.entryUsdc, alreadyJoined: true };
    }

    const room = await this.findOrCreateWaitingRoom(cfg);
    await this.ensureDevnetTestFunds(userSolanaAddress, cfg.entryUsdc);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, fromPubkey);
    const toAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${room.id}`, 'utf8') }),
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, this.usdcMint),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(cfg.entryUsdc * 1_000_000)),
    ];

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({ payerKey: treasuryKeypair.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]);

    return { txBase64: Buffer.from(tx.serialize()).toString('base64'), roomId: room.id, entryUsdc: cfg.entryUsdc };
  }

  private async findOrCreateWaitingRoom(cfg: RoomConfigPublic): Promise<{ id: string }> {
    const db = this.supabase.getClient();
    const { data: candidates, error } = await db
      .from('gacha_rooms')
      .select('id')
      .eq('config_key', cfg.configKey)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to list waiting gacha rooms: ${error.message}`);

    if (candidates?.length) {
      const counts = await this.countParticipantsByRoom(candidates.map((c: any) => c.id));
      const open = candidates.find((c: any) => (counts[c.id] ?? 0) < cfg.seats);
      if (open) return { id: open.id };
    }

    const { data: created, error: insertError } = await db
      .from('gacha_rooms')
      .insert({ config_key: cfg.configKey, pack_type: cfg.packType, seats: cfg.seats, entry_usdc: cfg.entryUsdc, status: 'waiting' })
      .select('id')
      .single();
    if (insertError || !created) throw new Error(`Failed to create gacha room: ${insertError?.message}`);
    return { id: created.id };
  }

  /**
   * Devnet testing convenience — Gacha is devnet-only end to end (see the class header), so
   * nothing here ever touches real money. A brand-new embedded wallet has zero devnet USDC-Dev
   * by default (there's no way for a tester to get it themselves besides a third-party faucet),
   * which would otherwise fail every join/bid-payment attempt on "insufficient funds" before
   * anyone gets anywhere. If the caller's balance is already short of what they're about to be
   * asked to pay, the treasury tops them up from its own (also devnet-only, faucet-funded)
   * balance first. There is no equivalent of this on mainnet and there must never be one — it
   * only exists because getSolanaConnection/this.usdcMint are hardcoded to devnet for this
   * entire module.
   */
  private async ensureDevnetTestFunds(userSolanaAddress: string, minUsdc: number): Promise<void> {
    const conn = await this.getSolanaConnection();
    const pubkey = new PublicKey(userSolanaAddress);
    const ata = await getAssociatedTokenAddress(this.usdcMint, pubkey);

    let currentUnits = 0n;
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      currentUnits = BigInt(bal.value.amount);
    } catch { /* no ATA yet — balance is 0 */ }

    const minUnits = BigInt(Math.round(minUsdc * 1_000_000));
    if (currentUnits >= minUnits) return;

    const treasuryKeypair = await this.getTreasuryKeypair();
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const topUpUnits = BigInt(Math.round(DEVNET_TEST_TOPUP_USDC * 1_000_000));

    const tx = new Transaction();
    tx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, ata, pubkey, this.usdcMint));
    tx.add(createTransferInstruction(fromAta, ata, treasuryKeypair.publicKey, topUpUnits));
    tx.feePayer = treasuryKeypair.publicKey;
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(treasuryKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    this.logger.log(`Devnet test top-up: sent ${DEVNET_TEST_TOPUP_USDC} USDC-Dev to ${userSolanaAddress} (sig=${sig})`);
  }

  /**
   * Devnet testing convenience — fills every open seat in a `waiting` room with fake
   * participants so a room can be tested solo, without needing that many real people/wallets.
   * Each "bot" is a real, freshly generated throwaway Solana keypair: the treasury funds its
   * entry share directly ("fee payer covers the balance"), and the bot then genuinely signs and
   * submits the exact same on-chain entry payment a real participant would — no shortcuts, no
   * bypassed verification, the money trail is fully real (just devnet-only, fake-value money).
   * Bots trickle in with a short randomized delay between each (matching demo mode's pacing)
   * rather than all landing in one instant. Hard-blocked outside non-production environments —
   * there is no legitimate reason this should ever be reachable in production.
   */
  async fillRemainingSeatsWithBots(roomId: string): Promise<{ queued: number }> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('Bots are not available in production');
    }
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, seats, entry_usdc, status').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'waiting') throw new BadRequestException('This room is no longer accepting joins');

    const currentCount = await this.getParticipantCount(roomId);
    const openSeats = room.seats - currentCount;
    if (openSeats <= 0) return { queued: 0 };

    // Fire-and-forget — the caller gets an immediate response; bots join one at a time in the
    // background so the lobby visibly fills instead of jumping straight to full.
    (async () => {
      for (let i = 0; i < openSeats; i++) {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 2200));
        await this.addBotParticipant(roomId, Number(room.entry_usdc)).catch((e) =>
          this.logger.error(`Room ${roomId}: bot join failed: ${e.message}`),
        );
      }
    })();

    return { queued: openSeats };
  }

  private async addBotParticipant(roomId: string, entryUsdc: number): Promise<void> {
    const db = this.supabase.getClient();
    // Re-check on every bot in case the room filled via a REAL join (or another bot) while this
    // one was waiting out its stagger delay — never oversell past a room's real seat count.
    const { data: room } = await db.from('gacha_rooms').select('id, seats, status').eq('id', roomId).maybeSingle();
    if (!room || room.status !== 'waiting') return;
    const currentCount = await this.getParticipantCount(roomId);
    if (currentCount >= room.seats) return;

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const bot = Keypair.generate();
    const botUserId = `bot-${bot.publicKey.toBase58().slice(0, 12)}`;

    const botAta = await getAssociatedTokenAddress(this.usdcMint, bot.publicKey);
    const treasuryFromAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const entryUnits = BigInt(Math.round(entryUsdc * 1_000_000));

    // Fund the bot's entry share directly from the treasury — this IS "the fee payer covering
    // the balance"; everything after this point is a completely normal, independently
    // verifiable on-chain payment, same as buildJoinTx/confirmJoin.
    const fundTx = new Transaction();
    fundTx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, botAta, bot.publicKey, this.usdcMint));
    fundTx.add(createTransferInstruction(treasuryFromAta, botAta, treasuryKeypair.publicKey, entryUnits));
    fundTx.feePayer = treasuryKeypair.publicKey;
    fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    fundTx.sign(treasuryKeypair);
    const fundSig = await conn.sendRawTransaction(fundTx.serialize());
    await conn.confirmTransaction(fundSig, 'confirmed');

    const treasuryToAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const joinTx = new Transaction();
    joinTx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${roomId}`, 'utf8') }));
    joinTx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, treasuryToAta, treasuryKeypair.publicKey, this.usdcMint));
    joinTx.add(createTransferInstruction(botAta, treasuryToAta, bot.publicKey, entryUnits));
    joinTx.feePayer = treasuryKeypair.publicKey;
    joinTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    joinTx.sign(treasuryKeypair, bot);
    const joinSig = await conn.sendRawTransaction(joinTx.serialize());
    await conn.confirmTransaction(joinSig, 'confirmed');

    // seat_number is NOT set here — the enforce_gacha_room_seat_cap trigger assigns it
    // atomically under a row lock on the room (see that migration) and ignores whatever's
    // passed, precisely to close the race that used to let two concurrent joins land on the
    // same seat number. Read back whatever the trigger actually assigned.
    const { data: inserted, error: insertError } = await db.from('gacha_room_participants').insert({
      room_id: roomId,
      user_id: botUserId,
      payment_tx_hash: joinSig,
    }).select('seat_number').single();
    if (insertError || !inserted) {
      this.logger.error(`Room ${roomId}: failed to record bot participant after a real on-chain join (sig=${joinSig}): ${insertError?.message}`);
      return;
    }
    const seatNumber = inserted.seat_number;

    this.logger.log(`Room ${roomId}: bot ${botUserId} joined seat ${seatNumber} (sig=${joinSig})`);
    // Bots never connect a websocket, so they can never call mark_ready themselves — without
    // this, a bot-filled room's ready count could never reach the total participant count, and
    // the real participant(s) marking themselves ready would wait forever. Simulates the bot
    // being instantly ready the moment it joins.
    this.events.emit(GACHA_EVENTS.BOT_READY, { roomId, botUserId });
    const roomFilled = seatNumber === room.seats;
    if (roomFilled) {
      await db.from('gacha_rooms').update({ status: 'purchasing', updated_at: new Date().toISOString() }).eq('id', roomId);
      this.purchaseAndOpenRoom(roomId).catch((e) => this.logger.error(`Room ${roomId}: purchase/open failed: ${e.message}`));
    }
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: seatNumber, seats: room.seats, status: roomFilled ? 'purchasing' : 'waiting' });
  }

  /** Debits the account that lost the most USDC in `tx` and returns its owner — same technique
   *  PackService.findUsdcDebitOwner uses to identify a payment's real sender. */
  private findUsdcDebitOwner(tx: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>): { owner: string | null; amount: bigint } {
    const usdcMint = this.usdcMint.toBase58();
    const preByIdx = new Map((tx.meta?.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
    const postByIdx = new Map((tx.meta?.postTokenBalances ?? []).map((b) => [b.accountIndex, b]));
    let debitOwner: string | null = null;
    let maxDebit = 0n;
    for (const [idx, post] of postByIdx) {
      if (post.mint !== usdcMint) continue;
      const pre = preByIdx.get(idx);
      if (!pre || pre.mint !== usdcMint) continue;
      const delta = BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount);
      if (delta > maxDebit) { maxDebit = delta; debitOwner = post.owner ?? pre.owner ?? null; }
    }
    return { owner: debitOwner, amount: maxDebit };
  }

  /** Reads the memo program's raw data out of a confirmed tx's top-level instructions, if any. */
  private extractMemo(tx: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>): string | null {
    const keys = tx.transaction.message.staticAccountKeys ?? tx.transaction.message.getAccountKeys?.().staticAccountKeys;
    const ixs = tx.transaction.message.compiledInstructions ?? (tx.transaction.message as any).instructions;
    if (!keys || !ixs) return null;
    for (const ix of ixs) {
      const programIdIndex = 'programIdIndex' in ix ? ix.programIdIndex : undefined;
      if (programIdIndex === undefined) continue;
      const programId = keys[programIdIndex];
      if (programId?.toBase58?.() !== MEMO_PROGRAM_ID.toBase58()) continue;
      const data = 'data' in ix ? ix.data : undefined;
      if (!data) continue;
      try { return Buffer.from(data as Uint8Array).toString('utf8'); } catch { return null; }
    }
    return null;
  }

  /** Verifies on-chain that `txHash` sent ≥`expectedUsdc` USDC to the treasury, FROM
   *  `expectedSender`, tagged with EXACTLY `expectedMemo` — the memo check is what lets this one
   *  shared treasury address disambiguate which room/bid a payment belongs to (PackService's
   *  equivalent never needed this since Mystery Pack has only one thing to ever pay for). */
  private async verifyOnChainPayment(txHash: string, expectedUsdc: number, expectedSender: string, expectedMemo: string, retries = 5): Promise<void> {
    const treasury = await this.getTreasuryAddress();
    const conn = await this.getSolanaConnection();
    const usdcMint = this.usdcMint.toBase58();

    for (let attempt = 0; ; attempt++) {
      const tx = await conn.getTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx) {
        if (tx.meta?.err) throw new BadRequestException('Payment transaction failed on-chain');
        const pre = tx.meta?.preTokenBalances?.find((b) => b.owner === treasury && b.mint === usdcMint);
        const post = tx.meta?.postTokenBalances?.find((b) => b.owner === treasury && b.mint === usdcMint);
        const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
        if (received < BigInt(Math.round(expectedUsdc * 1_000_000))) {
          throw new BadRequestException(`Payment paid ${received} units, expected ${Math.round(expectedUsdc * 1_000_000)}`);
        }
        const debit = this.findUsdcDebitOwner(tx);
        if (debit.owner !== expectedSender) throw new BadRequestException('This payment was not sent from your wallet');
        const memo = this.extractMemo(tx);
        if (memo !== expectedMemo) throw new BadRequestException('Payment memo does not match this room/bid');
        return;
      }
      if (attempt >= retries) throw new BadRequestException('Payment transaction not found on-chain — wait a few seconds and retry');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /**
   * Confirms a caller's entry payment and seats them. The seat-cap trigger on
   * gacha_room_participants (see migration) is the real race guard — this can be called
   * concurrently by every joiner without risk of overselling a room's seats.
   */
  async confirmJoin(roomId: string, userId: string, paymentTxHash: string): Promise<{ seatNumber: number; roomFilled: boolean }> {
    const db = this.supabase.getClient();
    const { data: room, error: roomError } = await db.from('gacha_rooms').select('id, status, entry_usdc, seats').eq('id', roomId).maybeSingle();
    if (roomError || !room) throw new NotFoundException('Room not found');
    if (room.status !== 'waiting') throw new BadRequestException(`Room is no longer accepting joins (status: ${room.status})`);

    const { data: existing } = await db.from('gacha_room_participants').select('id').eq('payment_tx_hash', paymentTxHash).maybeSingle();
    if (existing) throw new BadRequestException('This payment has already been used to join a room');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.verifyOnChainPayment(paymentTxHash, Number(room.entry_usdc), userSolanaAddress, `${ROOM_MEMO_PREFIX}${roomId}`);

    // seat_number is NOT set here — enforce_gacha_room_seat_cap assigns it atomically under a
    // row lock on the room (see that migration), closing a real race where two near-simultaneous
    // joins (e.g. this one racing a bot's) could both compute and insert the same seat number.
    const { data: inserted, error: insertError } = await db.from('gacha_room_participants').insert({
      room_id: roomId,
      user_id: userId,
      payment_tx_hash: paymentTxHash,
    }).select('seat_number').single();
    if (insertError || !inserted) {
      // Two different unique constraints can both raise 23505 here, and they mean different
      // things — buildJoinTx's own pre-check (see there) should catch the (room_id, user_id)
      // case before a payment is ever built, but this is the last line of defense against a
      // genuine race (e.g. two concurrent requests for the same already-seated user).
      const message = (insertError as any)?.message ?? '';
      if (message.includes('room_id_user_id')) throw new BadRequestException("You're already in this room.");
      if ((insertError as any)?.code === '23505') throw new BadRequestException('This payment has already been used to join a room');
      // Trigger-raised exception (room full) also lands here — Postgres reports it as a generic error, not 23505.
      throw new BadRequestException('This room just filled up — try another room');
    }
    const seatNumber = inserted.seat_number;

    const roomFilled = seatNumber === room.seats;
    if (roomFilled) {
      await db.from('gacha_rooms').update({ status: 'purchasing', updated_at: new Date().toISOString() }).eq('id', roomId);
      // Fire-and-forget: the joiner whose payment fills the room shouldn't have their HTTP
      // response blocked on the full purchase+open round trip (which can take up to ~1 minute —
      // see OPEN_POLL_MAX_ATTEMPTS). room:update below carries the seat count to everyone else
      // watching the lobby; purchaseAndOpenRoom emits its own room:opened once the pack reveals.
      this.purchaseAndOpenRoom(roomId).catch((e) => this.logger.error(`Room ${roomId}: purchase/open failed: ${e.message}`));
    }

    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: seatNumber, seats: room.seats, status: roomFilled ? 'purchasing' : 'waiting' });

    return { seatNumber, roomFilled };
  }

  // ── Pack purchase + open (treasury is the sole Collectorcrypt "player" — see plan doc) ──

  private async purchaseAndOpenRoom(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db.from('gacha_rooms').select('id, pack_type').eq('id', roomId).single();
    if (error || !room) throw new Error(`Room ${roomId} not found for purchase`);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();

    const generated = await this.collectorCrypt.generatePack(room.pack_type as CollectorCryptPackType, treasuryKeypair.publicKey.toBase58());
    const purchaseTxSig = await this.signAndSubmit(generated.transaction, treasuryKeypair, conn);
    await db.from('gacha_rooms').update({
      collectorcrypt_memo: generated.memo,
      purchase_tx_sig: purchaseTxSig,
      status: 'opening',
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    // result.success + result.nftWon is the real completion signal (confirmed live — see
    // OpenPackResponse's comment); result.status === 'waiting_for_webhook' is kept as a pending
    // signal per the docs prose but was never actually observed in testing.
    let opened: OpenPackResponse | null = null;
    for (let attempt = 0; attempt < OPEN_POLL_MAX_ATTEMPTS; attempt++) {
      const result = await this.collectorCrypt.openPack(generated.memo);
      if (result.success && result.nftWon) { opened = result; break; }
      await new Promise((r) => setTimeout(r, OPEN_POLL_INTERVAL_MS));
    }
    if (!opened?.nftWon) {
      await db.from('gacha_rooms').update({ status: 'failed', failure_reason: 'openPack never confirmed', updated_at: new Date().toISOString() }).eq('id', roomId);
      throw new Error(`Room ${roomId}: openPack never confirmed (timed out polling)`);
    }

    const nftWon = opened.nftWon;
    const mint = opened.nft_address ?? nftWon.id ?? null;
    const rarityRaw = (nftWon.rarity ?? '').toLowerCase();
    const rarity: PackRarityTier | null = (['common', 'uncommon', 'rare', 'epic'] as const).includes(rarityRaw as PackRarityTier)
      ? (rarityRaw as PackRarityTier)
      : null;
    const nftMetadata: NftMetadata = {
      mint: mint ?? undefined,
      name: nftWon.content?.metadata?.name,
      image: nftWon.content?.links?.image,
      insuredValueUsdc: nftWon.content?.metadata?.insuredValue ? Number(nftWon.content.metadata.insuredValue) : undefined,
    };

    const treasuryAddress = treasuryKeypair.publicKey.toBase58();
    let buybackAmountUsdc: number | null = null;
    if (mint) {
      try {
        const avail = await this.collectorCrypt.buybackAvailable(mint, treasuryAddress);
        if (avail.available && avail.amount !== undefined) buybackAmountUsdc = avail.amount / 1_000_000;
      } catch (e: any) {
        this.logger.warn(`Room ${roomId}: buybackAvailable check failed (non-fatal, starting bid at $0): ${e.message}`);
      }
    }

    const bidWindowEndsAt = new Date(Date.now() + BID_WINDOW_MS).toISOString();
    await db.from('gacha_rooms').update({
      nft_metadata: nftMetadata,
      rarity,
      open_tx_sig: opened.transactionSignature ?? null,
      buyback_amount_usdc: buybackAmountUsdc,
      status: 'bidding',
      bid_window_ends_at: bidWindowEndsAt,
      opened_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    this.logger.log(`Room ${roomId}: opened rarity=${rarity} buyback=$${buybackAmountUsdc} — bidding window open`);
    this.events.emit(GACHA_EVENTS.ROOM_OPENED, { roomId, nftMetadata, rarity, buybackAmountUsdc, bidWindowEndsAt });
  }

  private async signAndSubmit(unsignedTxBase64: string, signer: Keypair, conn: Connection): Promise<string> {
    const bytes = Buffer.from(unsignedTxBase64, 'base64');
    try {
      const vtx = VersionedTransaction.deserialize(bytes);
      vtx.sign([signer]);
      const submitted = await this.collectorCrypt.submitTransaction(Buffer.from(vtx.serialize()).toString('base64'));
      return submitted.signature;
    } catch {
      const tx = Transaction.from(bytes);
      tx.partialSign(signer);
      const submitted = await this.collectorCrypt.submitTransaction(tx.serialize({ requireAllSignatures: false }).toString('base64'));
      return submitted.signature;
    }
  }

  // ── Bidding (room participants only — see gacha_bids) ─────────────────────────────────

  async placeBid(roomId: string, userId: string, amountUsdc: number): Promise<{ id: string; amountUsdc: number }> {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new BadRequestException('Invalid bid amount');
    const db = this.supabase.getClient();

    const { data: room, error } = await db.from('gacha_rooms').select('id, status, bid_window_ends_at, buyback_amount_usdc').eq('id', roomId).maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');
    if (room.status !== 'bidding') throw new BadRequestException('This room is not currently accepting bids');
    if (!room.bid_window_ends_at || new Date(room.bid_window_ends_at).getTime() <= Date.now()) throw new BadRequestException('Bidding window has closed');

    const { data: participant } = await db.from('gacha_room_participants').select('id').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (!participant) throw new BadRequestException('Only room participants can bid');

    const { data: bestBid } = await db.from('gacha_bids').select('amount_usdc').eq('room_id', roomId).order('amount_usdc', { ascending: false }).limit(1).maybeSingle();
    const floor = bestBid ? Number(bestBid.amount_usdc) : Number(room.buyback_amount_usdc ?? 0);
    if (amountUsdc <= floor) throw new BadRequestException(`Bid must exceed the current best of $${floor.toFixed(2)}`);

    const { data: inserted, error: insertError } = await db.from('gacha_bids').insert({ room_id: roomId, user_id: userId, amount_usdc: amountUsdc }).select('id').single();
    if (insertError || !inserted) throw new Error(`Failed to record bid: ${insertError?.message}`);

    // Amount only — never the bidder's identity, so a room's other participants can watch the
    // price climb without seeing who's bidding against them.
    this.events.emit(GACHA_EVENTS.BID_PLACED, { roomId, amountUsdc });

    return { id: inserted.id, amountUsdc };
  }

  // ── Settlement ─────────────────────────────────────────────────────────────────────
  // NOTE: driven by a cron sweep (settleDueRooms), gated NODE_ENV=production per this repo's
  // cron convention — see gacha.cron.ts. A missed tick only delays settlement, never loses money.

  /** Dev-only escape hatch: settlement is ONLY ever driven by GachaCronService's sweep, which is
   *  hard-gated to NODE_ENV=production (two instances — local dev + Railway — settling the same
   *  room against the same Supabase project would race). That's correct for prod, but it also
   *  means a local dev room can sit in "bidding" forever with no way to ever see the buyback/
   *  bid-win path actually run. This settles ONE specific room immediately, regardless of whether
   *  its bid window has actually elapsed — same non-production-only guard as fillRemainingSeatsWithBots. */
  async devForceSettleRoom(roomId: string): Promise<{ status: string }> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('Force-settle is not available in production');
    }
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'bidding' && room.status !== 'settling') {
      throw new BadRequestException(`Room isn't in a settleable state (status: ${room.status})`);
    }
    await this.advanceToNextBidCandidate(roomId);
    const { data: after } = await db.from('gacha_rooms').select('status').eq('id', roomId).single();
    return { status: after?.status ?? room.status };
  }

  /** Cron entrypoint — advances every room whose bidding window has closed or whose current
   *  bid-payment grace window has expired. Safe to call repeatedly; each branch is idempotent
   *  against a room already past that state (re-reads status before acting). */
  async settleDueRooms(): Promise<void> {
    const db = this.supabase.getClient();
    const nowIso = new Date().toISOString();

    const { data: closedBidding } = await db.from('gacha_rooms').select('id').eq('status', 'bidding').lte('bid_window_ends_at', nowIso);
    for (const room of closedBidding ?? []) {
      await this.advanceToNextBidCandidate(room.id).catch((e) => this.logger.error(`Room ${room.id}: settlement advance failed: ${e.message}`));
    }

    const { data: expiredGrace } = await db.from('gacha_rooms').select('id').eq('status', 'settling').lte('pending_bid_deadline', nowIso).not('pending_bid_id', 'is', null);
    for (const room of expiredGrace ?? []) {
      await this.advanceToNextBidCandidate(room.id).catch((e) => this.logger.error(`Room ${room.id}: settlement advance failed: ${e.message}`));
    }
  }

  /** Picks the highest still-eligible bid the room hasn't already tried and given a grace
   *  window; if none remain (including "no bids at all"), falls through to auto-buyback. */
  private async advanceToNextBidCandidate(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status, pending_bid_id').eq('id', roomId).single();
    if (!room) return;

    if (room.pending_bid_id) {
      await db.from('gacha_bids').update({ status: 'expired_unpaid' }).eq('id', room.pending_bid_id).eq('status', 'active');
    }

    const { data: nextBid } = await db
      .from('gacha_bids')
      .select('id, amount_usdc')
      .eq('room_id', roomId)
      .eq('status', 'active')
      .order('amount_usdc', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!nextBid) {
      await this.finalizeBuybackSettlement(roomId);
      return;
    }

    await db.from('gacha_rooms').update({
      status: 'settling',
      pending_bid_id: nextBid.id,
      pending_bid_deadline: new Date(Date.now() + BID_PAYMENT_GRACE_MS).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);
  }

  /** Builds the winning bidder's payment-collection tx — only callable by the user currently
   *  holding `pending_bid_id` on a room in `settling` status, within the grace window. */
  async buildBidPaymentTx(roomId: string, userId: string): Promise<{ txBase64: string; amountUsdc: number }> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status, pending_bid_id, pending_bid_deadline').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'settling' || !room.pending_bid_id) throw new BadRequestException('No bid is currently awaiting payment on this room');
    if (!room.pending_bid_deadline || new Date(room.pending_bid_deadline).getTime() <= Date.now()) throw new BadRequestException('Payment window has expired');

    const { data: bid } = await db.from('gacha_bids').select('id, user_id, amount_usdc').eq('id', room.pending_bid_id).single();
    if (!bid || bid.user_id !== userId) throw new BadRequestException('You are not the current winning bidder on this room');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.ensureDevnetTestFunds(userSolanaAddress, Number(bid.amount_usdc));
    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, fromPubkey);
    const toAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${BID_MEMO_PREFIX}${bid.id}`, 'utf8') }),
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, this.usdcMint),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(Number(bid.amount_usdc) * 1_000_000)),
    ];
    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({ payerKey: treasuryKeypair.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]);

    return { txBase64: Buffer.from(tx.serialize()).toString('base64'), amountUsdc: Number(bid.amount_usdc) };
  }

  /** Confirms the winner actually paid — settles the room immediately rather than waiting for
   *  the next cron tick, since the winner is sitting there waiting for their reveal moment. */
  async confirmBidPayment(roomId: string, userId: string, paymentTxHash: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status, pending_bid_id, entry_usdc').eq('id', roomId).maybeSingle();
    if (!room || room.status !== 'settling' || !room.pending_bid_id) throw new BadRequestException('No bid is currently awaiting payment on this room');

    const { data: bid } = await db.from('gacha_bids').select('id, user_id, amount_usdc, status').eq('id', room.pending_bid_id).single();
    if (!bid || bid.user_id !== userId) throw new BadRequestException('You are not the current winning bidder on this room');
    if (bid.status !== 'active') throw new BadRequestException('This bid is no longer eligible (window likely expired)');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.verifyOnChainPayment(paymentTxHash, Number(bid.amount_usdc), userSolanaAddress, `${BID_MEMO_PREFIX}${bid.id}`);

    await db.from('gacha_bids').update({ status: 'won', payment_tx_hash: paymentTxHash }).eq('id', bid.id);
    await this.finalizeBidWinSettlement(roomId, bid.id, Number(bid.amount_usdc));
  }

  /** No winning bid (or every bidder let their window lapse) — treasury sells the NFT back via
   *  Collectorcrypt and the proceeds split evenly. Reads the ACTUAL on-chain USDC credited
   *  around buyback_tx_sig rather than trusting the API's stated refund figure — same "never
   *  trust the API's say-so, verify on-chain" posture as verifyOnChainPayment/PackService. */
  private async finalizeBuybackSettlement(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, seats, nft_metadata').eq('id', roomId).single();
    if (!room?.nft_metadata?.mint) throw new Error(`Room ${roomId}: cannot buyback — no NFT mint recorded`);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const treasuryAddress = treasuryKeypair.publicKey.toBase58();

    const built = await this.collectorCrypt.buyback(room.nft_metadata.mint, treasuryAddress);
    const preBalance = await this.getTreasuryUsdcUnits(conn, treasuryKeypair.publicKey);
    const buybackTxSig = await this.signAndSubmit(built.serializedTransaction, treasuryKeypair, conn);
    await this.pollConfirmed(conn, buybackTxSig);
    const postBalance = await this.getTreasuryUsdcUnits(conn, treasuryKeypair.publicKey);
    const receivedUnits = postBalance - preBalance;

    if (receivedUnits <= 0n) {
      await db.from('gacha_rooms').update({ status: 'failed', failure_reason: 'Buyback settled but no USDC credit detected on-chain', updated_at: new Date().toISOString() }).eq('id', roomId);
      throw new Error(`Room ${roomId}: buyback tx ${buybackTxSig} confirmed but treasury balance did not increase`);
    }

    await this.splitPayoutAndMarkSettled(roomId, room.seats, receivedUnits, { buybackTxSig });
  }

  /** A room participant won the auction outright — treasury transfers the actual NFT to their
   *  wallet, and the FULL winning bid (not the smaller buyback amount) splits evenly across
   *  every participant including the winner (see plan: "winner pays full bid, split N ways"). */
  private async finalizeBidWinSettlement(roomId: string, bidId: string, bidAmountUsdc: number): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, seats, nft_metadata').eq('id', roomId).single();
    const { data: bid } = await db.from('gacha_bids').select('user_id').eq('id', bidId).single();
    if (!room?.nft_metadata?.mint || !bid) throw new Error(`Room ${roomId}: cannot finalize bid win — missing NFT mint or bid`);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const winnerAddress = await this.usersService.getSolanaWalletAddress(bid.user_id);
    const nftTransferTxSig = await this.transferNftToWinner(conn, treasuryKeypair, new PublicKey(room.nft_metadata.mint), new PublicKey(winnerAddress));

    const receivedUnits = BigInt(Math.round(bidAmountUsdc * 1_000_000));
    await this.splitPayoutAndMarkSettled(roomId, room.seats, receivedUnits, { winningBidId: bidId, nftTransferTxSig });
  }

  private async transferNftToWinner(conn: Connection, treasuryKeypair: Keypair, nftMint: PublicKey, winner: PublicKey): Promise<string> {
    const { getAccount } = await import('@solana/spl-token');
    const fromAta = await getAssociatedTokenAddress(nftMint, treasuryKeypair.publicKey);
    const toAta = await getAssociatedTokenAddress(nftMint, winner);
    const account = await getAccount(conn, fromAta);

    const instructions: TransactionInstruction[] = [];
    if (!(await tokenAccountExists(conn, toAta))) {
      instructions.push(createAssociatedTokenAccountInstruction(treasuryKeypair.publicKey, toAta, winner, nftMint));
    }
    instructions.push(createTransferInstruction(fromAta, toAta, treasuryKeypair.publicKey, account.amount));

    const tx = new Transaction().add(...instructions);
    tx.feePayer = treasuryKeypair.publicKey;
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(treasuryKeypair);
    return conn.sendRawTransaction(tx.serialize());
  }

  private async getTreasuryUsdcUnits(conn: Connection, treasury: PublicKey): Promise<bigint> {
    const ata = await getAssociatedTokenAddress(this.usdcMint, treasury);
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      return BigInt(bal.value.amount);
    } catch { return 0n; }
  }

  private async pollConfirmed(conn: Connection, sig: string, attempts = 20): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      const status = await conn.getSignatureStatus(sig);
      if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') return;
      if (status.value?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(status.value.err)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  /** Splits `totalUnits` evenly across `seats` participants (any leftover dust from integer
   *  division goes to seat 1 — same "someone has to get the extra cent" tie-break other split
   *  logic in this codebase uses), records each participant's payout_usdc, and marks the room
   *  settled. Does NOT push any money yet — see claimPayout for why (private/public is each
   *  participant's own choice, made when they claim, not decided for them at settlement time). */
  private async splitPayoutAndMarkSettled(roomId: string, seats: number, totalUnits: bigint, extra: { buybackTxSig?: string; winningBidId?: string; nftTransferTxSig?: string }): Promise<void> {
    const db = this.supabase.getClient();
    const shareUnits = totalUnits / BigInt(seats);
    const dustUnits = totalUnits - shareUnits * BigInt(seats);

    const { data: participants } = await db.from('gacha_room_participants').select('id, seat_number').eq('room_id', roomId).order('seat_number', { ascending: true });
    for (const p of participants ?? []) {
      const units = shareUnits + (p.seat_number === 1 ? dustUnits : 0n);
      await db.from('gacha_room_participants').update({ payout_usdc: Number(units) / 1_000_000 }).eq('id', p.id);
    }

    await db.from('gacha_rooms').update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pending_bid_id: null,
      pending_bid_deadline: null,
      ...(extra.buybackTxSig ? { buyback_tx_sig: extra.buybackTxSig } : {}),
      ...(extra.winningBidId ? { winning_bid_id: extra.winningBidId } : {}),
      ...(extra.nftTransferTxSig ? { nft_transfer_tx_sig: extra.nftTransferTxSig } : {}),
    }).eq('id', roomId);

    this.logger.log(`Room ${roomId}: settled, ${seats} payouts of ~${Number(shareUnits) / 1_000_000} USDC each`);
    // Per-participant payout amounts + wallets are fetched over authenticated REST
    // (getRoomDetail), never broadcast — this event is just "go check your own claim screen".
    this.events.emit(GACHA_EVENTS.ROOM_SETTLED, { roomId, won: !!extra.winningBidId });
  }

  // ── Claim (each participant's own public/private choice — see plan doc) ──────────────

  /**
   * Pushes a settled participant's payout to their wallet. Public path mirrors
   * LotteryService.topUpFromFeeWallet exactly (treasury signs alone, guardAtaSponsorship
   * anti-drain check on a brand-new destination ATA). Private path mirrors the signing pattern
   * ClaimsService.sweepClaimBurnerPrivately uses — EXCEPT the ephemeral-rollup routing branch
   * (sendTo === 'ephemeral'), which is NOT implemented here yet (see the throw below): that
   * branch needs the same MagicBlock auth-token dance as
   * ClaimsService.getEphemeralConnectionForBurner, which was judged too risky to duplicate
   * freehand against real money without live devnet verification first. Until that's ported
   * over, a private claim that MagicBlock wants routed through an ephemeral rollup fails loudly
   * instead of silently mis-sending funds.
   */
  async claimPayout(roomId: string, userId: string, isPrivate: boolean): Promise<{ txSig: string }> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status').eq('id', roomId).maybeSingle();
    if (!room || room.status !== 'settled') throw new BadRequestException('This room has not settled yet');

    const { data: participant } = await db.from('gacha_room_participants').select('id, payout_usdc, payout_tx_sig').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (!participant) throw new BadRequestException('You are not a participant in this room');
    if (participant.payout_tx_sig) throw new BadRequestException('Payout already claimed');
    if (participant.payout_usdc === null) throw new BadRequestException('Payout has not been computed yet');

    const destination = await this.usersService.getSolanaWalletAddress(userId);
    const txSig = isPrivate
      ? await this.sendPrivatePayout(destination, Number(participant.payout_usdc))
      : await this.sendPublicPayout(destination, Number(participant.payout_usdc));

    await db.from('gacha_room_participants').update({ payout_tx_sig: txSig, payout_is_private: isPrivate }).eq('id', participant.id);
    return { txSig };
  }

  private async sendPublicPayout(toAddress: string, amountUsdc: number): Promise<string> {
    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const toPubkey = new PublicKey(toAddress);
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const toAta = await getAssociatedTokenAddress(this.usdcMint, toPubkey);

    const tx = new Transaction();
    if (!(await tokenAccountExists(conn, toAta))) {
      const allowed = await guardAtaSponsorship(this.supabase, toAddress, this.usdcMint.toBase58(), `gacha-payout:${toAddress}`);
      if (!allowed) throw new BadRequestException('This wallet already received a sponsored token account once before and closed it — free account creation is blocked to prevent abuse');
      tx.add(createAssociatedTokenAccountInstruction(treasuryKeypair.publicKey, toAta, toPubkey, this.usdcMint));
    }
    tx.add(createTransferInstruction(fromAta, toAta, treasuryKeypair.publicKey, Math.round(amountUsdc * 1_000_000)));
    tx.feePayer = treasuryKeypair.publicKey;
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(treasuryKeypair);
    return conn.sendRawTransaction(tx.serialize());
  }

  private async sendPrivatePayout(toAddress: string, amountUsdc: number): Promise<string> {
    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const cluster = 'devnet'; // Gacha Pooled Packs is devnet-only — see getSolanaConnection
    const relayFeeUnits = Math.round((await resolveMagicblockRelayFeeUsdc()) * 1_000_000);
    const transferUnits = Math.round(amountUsdc * 1_000_000) - relayFeeUnits; // exact-in: fee comes out of the payout, same as claims.service.ts's "claim privately" branch

    const txResponse = await requestMagicblockPrivateTransfer({
      from: treasuryKeypair.publicKey.toBase58(),
      to: toAddress,
      mint: this.usdcMint.toBase58(),
      amount: transferUnits,
      cluster,
      exactOut: false,
      gasless: true,
    });

    if (txResponse.sendTo === 'ephemeral') {
      throw new BadRequestException('Private claim is temporarily unavailable for this payout — please claim publicly instead, or try again shortly');
    }

    const bytes = Buffer.from(txResponse.transactionBase64, 'base64');
    let sig: string;
    try {
      const legacyTx = Transaction.from(bytes);
      legacyTx.feePayer = treasuryKeypair.publicKey;
      legacyTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      legacyTx.partialSign(treasuryKeypair);
      sig = await conn.sendRawTransaction(legacyTx.serialize({ requireAllSignatures: false }), { skipPreflight: true });
    } catch {
      const versionedTx = VersionedTransaction.deserialize(bytes);
      versionedTx.sign([treasuryKeypair]);
      sig = await conn.sendRawTransaction(versionedTx.serialize(), { skipPreflight: true });
    }
    await this.pollConfirmed(conn, sig);
    return sig;
  }

  // ── Admin ──────────────────────────────────────────────────────────────────────────

  async getAdminConfigs(): Promise<RoomConfigPublic[]> {
    this.configsCache = null;
    return this.loadConfigs();
  }

  async setConfigEnabled(configKey: string, enabled: boolean): Promise<void> {
    const db = this.supabase.getClient();
    const { error } = await db.from('gacha_room_configs').update({ enabled, updated_at: new Date().toISOString() }).eq('config_key', configKey);
    if (error) throw new BadRequestException(`Unknown room config: ${configKey}`);
    this.configsCache = null;
  }

  async getAdminRooms(page: number, pageSize: number): Promise<{ data: RoomSummary[]; total: number; page: number; limit: number }> {
    const db = this.supabase.getClient();
    const { data, count, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, pack_type, seats, entry_usdc, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(`Failed to load gacha rooms: ${error.message}`);
    const roomIds = (data ?? []).map((r: any) => r.id);
    const counts = await this.countParticipantsByRoom(roomIds);
    return {
      data: (data ?? []).map((r: any) => ({
        id: r.id, configKey: r.config_key, packType: r.pack_type, seats: r.seats, entryUsdc: Number(r.entry_usdc),
        status: r.status, seatsFilled: counts[r.id] ?? 0, nftMetadata: r.nft_metadata, rarity: r.rarity,
        buybackAmountUsdc: r.buyback_amount_usdc !== null ? Number(r.buyback_amount_usdc) : null,
        bidWindowEndsAt: r.bid_window_ends_at, createdAt: r.created_at,
      })),
      total: count ?? 0, page, limit: pageSize,
    };
  }
}
