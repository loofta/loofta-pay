import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
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
import { GachaVrfService } from './gacha-vrf.service';
import { GachaOnchainStateService } from './gacha-onchain-state.service';
// Pure/dependency-free — same selection math the giveaways VRF draw uses (sha256(randomness+':'+id),
// sort, take first N). For the exclusion game we call it with exclusionCount and treat the
// returned ids as EXCLUDED rather than as winners; the function's contract doesn't change.
import { selectRandomWinners } from '../giveaways/giveaway-draw-selection';

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

const BID_PAYMENT_GRACE_MS = 5 * 60_000;

const OPEN_POLL_INTERVAL_MS = 3_000;
const OPEN_POLL_MAX_ATTEMPTS = 20; // ~1 minute total — openPack's "waiting_for_webhook" state

// Same 20 keys as apps/frontend/public/images/mascots/ and the gacha_room_participants
// mascot_key CHECK constraint (migration 20260808120000) — the one place this list is validated
// against on the backend; the gateway's lock_mascot handler just forwards to lockMascot below
// and relays whatever error it throws, rather than duplicating this whitelist itself.
const MASCOT_KEYS = [
  'axolotl', 'bear', 'bunny', 'cat', 'chick', 'crab', 'dog', 'duck', 'fox', 'goat',
  'hamster', 'octopus', 'owl', 'penguin', 'pig', 'raccoon', 'shark', 'sloth', 'snail', 'turtle',
] as const;

const EXCLUSION_VRF_STALL_MS = 15 * 60_000; // same threshold as GIVEAWAY_VRF_STALL_MINUTES default

// See ensureDevnetTestFunds — devnet-only test-wallet funding, covers several room joins/bids.
const DEVNET_TEST_TOPUP_USDC = 100;

export interface RoomConfigPublic {
  configKey: string;
  packType: CollectorCryptPackType;
  seats: number;
  entryUsdc: number;
  exclusionCount: number;
  enabled: boolean;
  displayOrder: number;
}

export interface RoomSummary {
  id: string;
  configKey: string;
  packType: string;
  seats: number;
  entryUsdc: number;
  exclusionCount: number;
  voteRound: number | null;
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
    private readonly vrf: GachaVrfService,
    private readonly onchainState: GachaOnchainStateService,
  ) {
    this.usdcMint = new PublicKey(this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || DEFAULT_DEVNET_USDC_MINT);
  }

  // Phase 2 of the MagicBlock ER migration (see the plan doc) — vote tallies, default off. When
  // true, startVoteRound/castVote/round-completion logic below runs against the on-chain
  // GachaRoomState PDA (same account Phase 1's ready-state uses) instead of voteByRoom/
  // voteRoundStartedAt. Independent of GACHA_ONCHAIN_READY_STATE — either can be on alone.
  private get onchainVoteStateEnabled(): boolean {
    return this.config.get<string>('GACHA_ONCHAIN_VOTE_STATE') === 'true';
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
      .select('config_key, pack_type, seats, entry_usdc, exclusion_count, enabled, display_order')
      .order('display_order', { ascending: true });
    if (error) throw new Error(`Failed to load gacha room configs: ${error.message}`);

    const configs: RoomConfigPublic[] = (data ?? []).map((r: any) => ({
      configKey: r.config_key,
      packType: r.pack_type,
      seats: r.seats,
      entryUsdc: Number(r.entry_usdc),
      exclusionCount: r.exclusion_count,
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
      .select('id, config_key, pack_type, seats, entry_usdc, exclusion_count, vote_round, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at')
      .in('status', ['waiting', 'excluding', 'purchasing', 'opening', 'bidding', 'settling'])
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
      exclusionCount: r.exclusion_count,
      voteRound: r.vote_round,
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
      .select('id, config_key, pack_type, seats, entry_usdc, exclusion_count, vote_round, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at')
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
      exclusionCount: r.exclusion_count,
      voteRound: r.vote_round,
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

  /** Bot participants (see addBotParticipant) are treated as ALWAYS ready — computed here from
   *  the `bot-` user id prefix rather than tracked via an in-memory "bot just joined" event.
   *  Tracking it as an event (the previous design) was fragile: a bot never reconnects a socket,
   *  so if the backend process restarts for ANY reason after it joins — a dev-server hot reload
   *  being the common case, but equally a real prod redeploy — its one-time ready signal is gone
   *  for good, and the room's real participant(s) end up waiting forever for a ready count that
   *  can now never be reached. Computing it structurally from who's a bot removes that failure
   *  mode entirely: it's correct on every read, independent of process uptime. */
  async getBotSeatNumbers(roomId: string): Promise<number[]> {
    const db = this.supabase.getClient();
    const { data } = await db.from('gacha_room_participants').select('seat_number, user_id').eq('room_id', roomId);
    return (data ?? []).filter((r: any) => typeof r.user_id === 'string' && r.user_id.startsWith('bot-')).map((r: any) => r.seat_number);
  }

  /** The room's FIXED seat capacity — used by GachaGateway as the "everyone ready" threshold.
   *  Deliberately NOT getParticipantCount (how many have joined so far): comparing against the
   *  live, still-filling count let a solo early joiner's ready click satisfy "all ready" against
   *  a total of 1, firing the reveal animation immediately with nothing yet to reveal — confirmed
   *  live (a 10-seat room whose only real participant marked ready right after joining solo, long
   *  before the room was bot-filled to capacity, got stuck mid pack-opening animation waiting on a
   *  card that hadn't been purchased yet). The threshold must be the capacity the room will
   *  eventually reach, not whatever's true at the instant someone clicks ready. */
  async getRoomSeats(roomId: string): Promise<number | null> {
    const db = this.supabase.getClient();
    const { data } = await db.from('gacha_rooms').select('seats').eq('id', roomId).maybeSingle();
    return data?.seats ?? null;
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
    myParticipant: { seatNumber: number; payoutUsdc: number | null; payoutIsPrivate: boolean | null; claimed: boolean; mascotKey: string | null; mascotLocked: boolean; excluded: boolean } | null;
    bestBid: { amountUsdc: number } | null;
    pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
    participants: Array<{ seatNumber: number; username: string | null; isMe: boolean; mascotKey: string | null; mascotLocked: boolean; excluded: boolean }>;
  }> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, pack_type, seats, entry_usdc, exclusion_count, vote_round, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, pending_bid_id, created_at')
      .eq('id', roomId)
      .maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');

    const counts = await this.countParticipantsByRoom([roomId]);
    const { data: mine } = await db.from('gacha_room_participants').select('seat_number, payout_usdc, payout_is_private, payout_tx_sig, mascot_key, mascot_locked_at, excluded').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    const { data: bestBid } = await db.from('gacha_bids').select('amount_usdc').eq('room_id', roomId).order('amount_usdc', { ascending: false }).limit(1).maybeSingle();

    // Seat + username only, for the round-table UI — never the wallet or full user id, same
    // "don't leak more than the UI needs" posture as bid amounts already being anonymous.
    const { data: seatRows } = await db.from('gacha_room_participants').select('seat_number, user_id, mascot_key, mascot_locked_at, excluded').eq('room_id', roomId).order('seat_number', { ascending: true });
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
      mascotKey: r.mascot_key ?? null,
      mascotLocked: !!r.mascot_locked_at,
      excluded: !!r.excluded,
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
        exclusionCount: room.exclusion_count, voteRound: room.vote_round,
        status: room.status, seatsFilled: counts[roomId] ?? 0, nftMetadata: room.nft_metadata, rarity: room.rarity,
        buybackAmountUsdc: room.buyback_amount_usdc !== null ? Number(room.buyback_amount_usdc) : null,
        bidWindowEndsAt: room.bid_window_ends_at, createdAt: room.created_at,
      },
      myParticipant: mine
        ? {
            seatNumber: mine.seat_number,
            payoutUsdc: mine.payout_usdc !== null ? Number(mine.payout_usdc) : null,
            payoutIsPrivate: mine.payout_is_private,
            claimed: !!mine.payout_tx_sig,
            mascotKey: mine.mascot_key ?? null,
            mascotLocked: !!mine.mascot_locked_at,
            excluded: !!mine.excluded,
          }
        : null,
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
      .insert({ config_key: cfg.configKey, pack_type: cfg.packType, seats: cfg.seats, entry_usdc: cfg.entryUsdc, exclusion_count: cfg.exclusionCount, status: 'waiting' })
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

  /** sendRawTransaction wrapped so a devnet SendTransactionError logs its full on-chain
   *  simulation logs immediately — the bare error.message is just "Catch the SendTransactionError
   *  and call getLogs() on it for full details", not the details themselves. getLogs() needs an
   *  explicit connection to refetch the logs when they weren't embedded in the RPC error already. */
  private async sendAndLog(conn: Connection, tx: Transaction, context: string): Promise<string> {
    try {
      return await conn.sendRawTransaction(tx.serialize());
    } catch (e) {
      if (e instanceof SendTransactionError) {
        const logs = await e.getLogs(conn).catch(() => e.logs ?? null);
        this.logger.error(`${context}: SendTransactionError — ${e.message}\nLogs: ${JSON.stringify(logs, null, 2)}`);
      }
      throw e;
    }
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
    const fundSig = await this.sendAndLog(conn, fundTx, `Room ${roomId}: bot ${botUserId} fund tx`);
    await conn.confirmTransaction(fundSig, 'confirmed');

    const treasuryToAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const joinTx = new Transaction();
    joinTx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${roomId}`, 'utf8') }));
    joinTx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, treasuryToAta, treasuryKeypair.publicKey, this.usdcMint));
    joinTx.add(createTransferInstruction(botAta, treasuryToAta, bot.publicKey, entryUnits));
    joinTx.feePayer = treasuryKeypair.publicKey;
    joinTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    joinTx.sign(treasuryKeypair, bot);
    const joinSig = await this.sendAndLog(conn, joinTx, `Room ${roomId}: bot ${botUserId} join tx`);
    await conn.confirmTransaction(joinSig, 'confirmed');

    // seat_number is NOT set here — the enforce_gacha_room_seat_cap trigger assigns it
    // atomically under a row lock on the room (see that migration) and ignores whatever's
    // passed, precisely to close the race that used to let two concurrent joins land on the
    // same seat number. Read back whatever the trigger actually assigned.
    const { data: inserted, error: insertError } = await db.from('gacha_room_participants').insert({
      room_id: roomId,
      user_id: botUserId,
      payment_tx_hash: joinSig,
    }).select('id, seat_number').single();
    if (insertError || !inserted) {
      this.logger.error(`Room ${roomId}: failed to record bot participant after a real on-chain join (sig=${joinSig}): ${insertError?.message}`);
      return;
    }
    const seatNumber = inserted.seat_number;

    // Bots never connect a websocket, so they can never call lock_mascot themselves — auto-lock
    // one deterministically by seat number right away (seat numbers are 1-10, well within the
    // 20-mascot set, so this alone can never collide within one room) so a bot never leaves the
    // room stuck waiting on a mascot lock the way it would on a mark_ready click.
    const mascotKey = MASCOT_KEYS[(seatNumber - 1) % MASCOT_KEYS.length];
    await db.from('gacha_room_participants').update({ mascot_key: mascotKey, mascot_locked_at: new Date().toISOString() }).eq('id', inserted.id);

    this.logger.log(`Room ${roomId}: bot ${botUserId} joined seat ${seatNumber} as ${mascotKey} (sig=${joinSig})`);
    // Bots never connect a websocket, so they can never call mark_ready themselves — GachaGateway
    // treats every bot seat as always-ready by computing it from getBotSeatNumbers (the `bot-`
    // user id prefix) rather than from an event fired here, so there's nothing to emit at join
    // time anymore — see getBotSeatNumbers' comment for why the event-based version was fragile.
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: seatNumber, seats: room.seats, status: 'waiting' });
    // Same threshold check a real participant's lock_mascot triggers — a bot filling/locking the
    // last seat must be able to start the exclusion draw too, since it has no socket to do it via.
    await this.maybeAdvanceToRipping(roomId);
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
  /** Mascot is now chosen BEFORE joining (see the frontend entry flow: pick mascot -> pick room
   *  size -> join), so `mascotKey` rides along with the join call and gets locked in immediately
   *  once the seat is confirmed — no separate in-room "pick" step for a real join anymore. */
  async confirmJoin(roomId: string, userId: string, paymentTxHash: string, mascotKey: string): Promise<{ seatNumber: number; roomFilled: boolean }> {
    if (!(MASCOT_KEYS as readonly string[]).includes(mascotKey)) throw new BadRequestException('Unknown mascot');
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
      mascot_key: mascotKey,
      mascot_locked_at: new Date().toISOString(),
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
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: seatNumber, seats: room.seats, status: 'waiting' });
    // In case this join was ALSO the last mascot lock needed (always true now, since mascots are
    // pre-chosen) — mirrors the same check bot joins already trigger.
    await this.maybeAdvanceToRipping(roomId);

    return { seatNumber, roomFilled };
  }

  // ── Mascot lock-in, VRF exclusion draw, and vote-to-cut-more (Pack Party flow) ─────────
  // Room lifecycle: waiting -> purchasing -> opening (RIP) -> excluding (EAT) ->
  // voting (0+ rounds, CUT ONE MORE?) -> settled (WINNERS). A room stays 'waiting' once every
  // seat is filled until every seated participant has ALSO locked in a mascot (see
  // maybeAdvanceToRipping) — only then does the pack purchase begin. The exclusion draw runs
  // once the pack is OPEN (see purchaseAndOpenRoom), not before — the rip is the moment, and the
  // roulette follows it. After the initial exclusion, survivors vote each round on cutting one
  // more (see startVoteRound/castVote/checkVoteRoundComplete) until a round doesn't pass or only
  // one survivor remains, at which point finalizeBuybackSettlement runs exactly as before.

  /** Called from confirmJoin/addBotParticipant right after a seat is confirmed — mascots are
   *  picked BEFORE joining now (see the frontend entry flow), so there's no separate in-room
   *  "pick" step for a real join to race; this just persists the pre-chosen key. Still used by
   *  the dormant lock_mascot socket path too, for anything that predates the pre-choice flow. */
  private async lockMascotForParticipant(roomId: string, participantId: string, mascotKey: string): Promise<void> {
    if (!(MASCOT_KEYS as readonly string[]).includes(mascotKey)) throw new BadRequestException('Unknown mascot');
    await this.supabase.getClient().from('gacha_room_participants').update({ mascot_key: mascotKey, mascot_locked_at: new Date().toISOString() }).eq('id', participantId);
  }

  /** Dormant since mascots are now chosen before joining (see lockMascotForParticipant) — kept
   *  for the lock_mascot socket event in case anything still needs a post-join pick path. */
  async lockMascot(roomId: string, userId: string, mascotKey: string): Promise<{ seatNumber: number }> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'waiting') throw new BadRequestException('Mascots can only be locked in while the room is still filling');

    const { data: participant } = await db.from('gacha_room_participants').select('id, seat_number, mascot_locked_at').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (!participant) throw new BadRequestException('You are not a participant in this room');
    if (participant.mascot_locked_at) throw new BadRequestException('Your mascot is already locked in');

    await this.lockMascotForParticipant(roomId, participant.id, mascotKey);
    await this.maybeAdvanceToRipping(roomId);
    return { seatNumber: participant.seat_number };
  }

  /** Re-checked after every mascot lock (now normally via confirmJoin/addBotParticipant, since
   *  the mascot is chosen before joining) — mirrors the "recheck the threshold on every relevant
   *  event" posture GachaGateway.maybeFireAllReady already uses for the ready-check. Flips the
   *  room to 'purchasing' and kicks off the real pack purchase the instant the LAST lock lands. */
  private async maybeAdvanceToRipping(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, seats, status').eq('id', roomId).maybeSingle();
    if (!room || room.status !== 'waiting') return;

    const { data: participants } = await db.from('gacha_room_participants').select('mascot_locked_at').eq('room_id', roomId);
    const rows = participants ?? [];
    if (rows.length < room.seats) return;
    if (rows.some((p: any) => !p.mascot_locked_at)) return;

    await db.from('gacha_rooms').update({ status: 'purchasing', updated_at: new Date().toISOString() }).eq('id', roomId);
    this.logger.log(`Room ${roomId}: all ${room.seats} seats filled and locked in — buying the pack`);
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: rows.length, seats: room.seats, status: 'purchasing' });

    // Fire-and-forget — the room-filling moment should feel instant rather than waiting for the
    // next cron tick.
    this.purchaseAndOpenRoom(roomId).catch((e) => this.logger.error(`Room ${roomId}: purchase/open failed: ${e.message}`));
  }

  /** Ticks a VRF draw forward exactly one step for the given (roomId, seed) pair, using
   *  vrf_requested_at/vrf_randomness nullability on gacha_rooms as the implicit sub-state — same
   *  pattern giveaway-draw.service.ts's advanceVrf uses. Shared by the initial exclusion draw and
   *  every vote-cut round's draw: each round reuses the SAME columns, reset to null before a new
   *  one starts (only one draw is ever in flight for a room at a time), with `seed` giving each
   *  round its own on-chain PDA (bare roomId for the initial draw, `${roomId}:vote:${round}` for
   *  vote-cut draws — gacha-vrf.service.ts just hashes whatever string it's given). Returns the
   *  resolved hex once fulfilled, or null while still in flight. Never falls back to non-VRF
   *  randomness silently — a stalled request is only logged, same posture as giveaways. */
  private async pollOrRequestVrf(roomId: string, seed: string): Promise<string | null> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('vrf_requested_at, vrf_randomness').eq('id', roomId).single();
    if (!room) return null;
    if (room.vrf_randomness) return room.vrf_randomness;

    if (!room.vrf_requested_at) {
      try {
        const { slot } = await this.vrf.requestRandomness(seed);
        await db.from('gacha_rooms').update({ vrf_requested_at: new Date().toISOString(), vrf_request_slot: slot }).eq('id', roomId);
        this.logger.log(`Room ${roomId}: VRF randomness requested for "${seed}" (slot=${slot})`);
      } catch (e: any) {
        this.logger.error(`Room ${roomId}: VRF request failed for "${seed}": ${e.message} (will retry next tick)`);
      }
      return null;
    }

    const randomnessHex = await this.vrf.pollFulfillment(seed);
    if (!randomnessHex) {
      const requestedAgeMs = Date.now() - new Date(room.vrf_requested_at).getTime();
      if (requestedAgeMs >= EXCLUSION_VRF_STALL_MS) {
        this.logger.error(`Room ${roomId}: VRF request for "${seed}" has been pending longer than the stall threshold — needs manual attention`);
      }
      return null;
    }
    await db.from('gacha_rooms').update({ vrf_randomness: randomnessHex, vrf_fulfilled_at: new Date().toISOString() }).eq('id', roomId);
    this.logger.log(`Room ${roomId}: VRF randomness fulfilled for "${seed}"`);
    return randomnessHex;
  }

  /** Cron entrypoint — advances every room currently mid-exclusion-draw one step (mirrors
   *  settleDueRooms below). Safe to call repeatedly; each room's own randomness/status columns
   *  make every branch idempotent. */
  async advanceExcludingRooms(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: rooms } = await db.from('gacha_rooms').select('id').eq('status', 'excluding');
    for (const room of rooms ?? []) {
      await this.advanceExclusionDraw(room.id).catch((e) => this.logger.error(`Room ${room.id}: exclusion draw advance failed: ${e.message}`));
    }
  }

  /** Once fulfilled: computes the exclusion set via the same selectRandomWinners the giveaways
   *  draw uses (called with exclusion_count and treated as EXCLUDED, not winners), persists it,
   *  and moves the room on to voting (CUT ONE MORE?) — the pack purchase already happened before
   *  this draw even started (see purchaseAndOpenRoom). */
  private async advanceExclusionDraw(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status, exclusion_count').eq('id', roomId).single();
    if (!room || room.status !== 'excluding') return;

    const randomnessHex = await this.pollOrRequestVrf(roomId, roomId);
    if (!randomnessHex) return;

    const { data: participants } = await db.from('gacha_room_participants').select('id, user_id, seat_number').eq('room_id', roomId).order('seat_number', { ascending: true });
    const rows = participants ?? [];
    // user_id is unique per room (UNIQUE(room_id, user_id)), so keying the selection by it is safe.
    const excludedUserIds = new Set(selectRandomWinners(rows.map((p: any) => p.user_id), randomnessHex, room.exclusion_count));
    const excludedSeatNumbers: number[] = [];
    for (const p of rows) {
      if (excludedUserIds.has(p.user_id)) {
        await db.from('gacha_room_participants').update({ excluded: true }).eq('id', p.id);
        excludedSeatNumbers.push(p.seat_number);
      }
    }

    await db.from('gacha_rooms').update({ status: 'voting', vote_round: 1, updated_at: new Date().toISOString() }).eq('id', roomId);
    this.logger.log(`Room ${roomId}: exclusion draw resolved — ${excludedSeatNumbers.length}/${rows.length} excluded (seats ${excludedSeatNumbers.join(', ')})`);
    this.events.emit(GACHA_EVENTS.ROOM_EXCLUDED, { roomId, excludedSeatNumbers });

    await this.startVoteRound(roomId, 1);
  }

  // ── Voting: "CUT ONE MORE?" (survivors vote after the initial exclusion) ──────────────
  // Vote tallies are in-memory only (same "live consensus, not a durable fact" posture as
  // GachaGateway's readyByRoom/emojiByRoom) — the only thing that needs to be durable is a vote
  // round's OUTCOME (another participant flipped to excluded = true), which lands in Postgres
  // exactly the same way the initial exclusion draw's outcome does. A backend restart mid-round
  // only costs that round's in-flight tally, never loses or double-applies a committed exclusion.
  private readonly voteByRoom = new Map<string, Map<string, boolean>>();
  private readonly voteRoundStartedAt = new Map<string, number>();
  private readonly VOTE_ROUND_MS = 30_000;

  // castVote and maybeTimeoutVoteRound both read the room/survivors via awaited Supabase calls
  // BEFORE touching voteByRoom — without serializing them per room, the 15s cron sweep's timeout
  // check could interleave inside that gap: it sees the real player's vote as "still missing",
  // auto-votes NO for them, and finalizes the round (flipping gacha_rooms.status away from
  // 'voting') before the real vote's write ever lands — the player's actual click then gets
  // written into an orphaned tally nothing reads again, silently discarded. This queue makes the
  // two entry points run strictly one-at-a-time per room so that gap can never be raced.
  private readonly voteLocks = new Map<string, Promise<unknown>>();
  private async withVoteLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.voteLocks.get(roomId) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    this.voteLocks.set(roomId, run.catch(() => undefined));
    return run;
  }

  private async getSurvivors(roomId: string): Promise<Array<{ id: string; user_id: string; seat_number: number }>> {
    const db = this.supabase.getClient();
    const { data } = await db.from('gacha_room_participants').select('id, user_id, seat_number').eq('room_id', roomId).eq('excluded', false).order('seat_number', { ascending: true });
    return data ?? [];
  }

  /** Starts a fresh voting round: computes bot votes once up front (bots have no socket to vote
   *  over — same reasoning as bots auto-locking mascots/always-ready), at a YES probability that
   *  decreases each round (0.72 round 1, floor 0.08) so later rounds feel more like a real
   *  survivors'-dilemma than an easy rubber stamp. Then checks completion immediately, in case
   *  every survivor left is a bot (a fully-demo-mode room shouldn't need a human to ever click). */
  private async startVoteRound(roomId: string, round: number): Promise<void> {
    const survivors = await this.getSurvivors(roomId);
    const yesP = Math.max(0.72 - (round - 1) * 0.28, 0.08);
    this.logger.log(`Room ${roomId}: vote round ${round} started (${survivors.length} survivors)`);
    this.events.emit(GACHA_EVENTS.ROOM_VOTE_ROUND_STARTED, { roomId, round, survivorSeatNumbers: survivors.map((p) => p.seat_number) });

    if (this.onchainVoteStateEnabled) {
      const seats = await this.getRoomSeats(roomId);
      if (seats === null) return;
      await this.onchainState.ensureRoomDelegated(roomId, seats);
      await this.onchainState.startVoteRound(roomId, round, survivors.map((p) => p.seat_number));
      for (const p of survivors) {
        if (p.user_id.startsWith('bot-')) await this.onchainState.castVote(roomId, p.seat_number, Math.random() < yesP);
      }
      await this.checkVoteRoundCompleteOnchain(roomId, round);
      return;
    }

    const tally = new Map<string, boolean>();
    for (const p of survivors) {
      if (p.user_id.startsWith('bot-')) tally.set(p.user_id, Math.random() < yesP);
    }
    this.voteByRoom.set(roomId, tally);
    this.voteRoundStartedAt.set(roomId, Date.now());
    await this.checkVoteRoundComplete(roomId, round);
  }

  /** Called from the gateway's cast_vote handler. Only a CURRENT survivor can vote, and only
   *  while this round is still collecting votes (not already locked in and mid-VRF-draw). */
  async castVote(roomId: string, userId: string, vote: boolean): Promise<{ round: number }> {
    return this.withVoteLock(roomId, async () => {
      const db = this.supabase.getClient();
      const { data: room } = await db.from('gacha_rooms').select('id, status, vote_round, vrf_requested_at').eq('id', roomId).maybeSingle();
      if (!room) throw new NotFoundException('Room not found');
      if (room.status !== 'voting') throw new BadRequestException('This room is not currently voting');
      if (room.vrf_requested_at) throw new BadRequestException('This round has already locked in — wait for the next one');

      const survivors = await this.getSurvivors(roomId);
      const me = survivors.find((p) => p.user_id === userId);
      if (!me) throw new BadRequestException('You are not eligible to vote in this room');

      if (this.onchainVoteStateEnabled) {
        await this.onchainState.castVote(roomId, me.seat_number, vote);
        await this.checkVoteRoundCompleteOnchain(roomId, room.vote_round);
        return { round: room.vote_round };
      }

      let tally = this.voteByRoom.get(roomId);
      if (!tally) { tally = new Map(); this.voteByRoom.set(roomId, tally); }
      tally.set(userId, vote);

      await this.checkVoteRoundComplete(roomId, room.vote_round);
      return { round: room.vote_round };
    });
  }

  /** Tallies once every current survivor has a vote recorded (bot + real). Ties count as YES —
   *  `yesCount * 2 >= totalCount` — a deliberate choice distinct from a strict majority, made
   *  explicitly for this feature (see PLAN doc). NO, or only 1 survivor, ends voting and settles;
   *  YES fires a fresh VRF request for this round's cut (fire-and-forget, same posture as every
   *  other VRF kick in this file — advanceVotingRooms' cron sweep carries it to resolution). */
  private async checkVoteRoundComplete(roomId: string, round: number): Promise<void> {
    const survivors = await this.getSurvivors(roomId);
    const tally = this.voteByRoom.get(roomId) ?? new Map<string, boolean>();
    if (survivors.some((p) => !tally.has(p.user_id))) return; // still waiting on someone

    const yesCount = survivors.filter((p) => tally.get(p.user_id) === true).length;
    const totalCount = survivors.length;
    const passed = totalCount > 1 && yesCount * 2 >= totalCount;
    this.logger.log(`Room ${roomId}: vote round ${round} complete — ${yesCount}/${totalCount} YES (${passed ? 'cutting one more' : 'locked in'})`);
    this.events.emit(GACHA_EVENTS.ROOM_VOTE_RESULT, { roomId, round, yesCount, totalCount, passed });

    if (!passed) {
      this.voteByRoom.delete(roomId);
      this.voteRoundStartedAt.delete(roomId);
      await this.finalizeBuybackSettlement(roomId);
      return;
    }

    const db = this.supabase.getClient();
    this.vrf
      .requestRandomness(`${roomId}:vote:${round}`)
      .then(({ slot }) => db.from('gacha_rooms').update({ vrf_requested_at: new Date().toISOString(), vrf_request_slot: slot }).eq('id', roomId))
      .catch((e: any) => this.logger.error(`Room ${roomId}: vote-cut VRF request failed (will retry via cron): ${e.message}`));
  }

  /** On-chain counterpart to checkVoteRoundComplete. Reads the tally BEFORE attempting to
   *  finalize (not after) so the yes/total counts used for the pass/fail decision below can't be
   *  changed by a finalize call that itself doesn't touch yes_mask/survivor_mask — and, critically,
   *  so an already-`finalized` round is caught here and returned on early, before ever calling
   *  finalize_vote_round again: the on-chain instruction is idempotent (a second call against an
   *  already-finalized round is a no-op, not an error), so without this pre-read guard every
   *  subsequent call after the first successful finalize (the next cron tick, another survivor's
   *  vote landing a moment later) would re-run the passed/!passed branch below a second time —
   *  double-firing the VRF request or double-calling finalizeBuybackSettlement. Skipping the
   *  on-chain finalize call entirely when the tally isn't complete and the deadline hasn't passed
   *  also avoids submitting a transaction that would only fail with RoundStillOpen. */
  private async checkVoteRoundCompleteOnchain(roomId: string, round: number): Promise<void> {
    const state = await this.onchainState.getVoteState(roomId);
    if (!state || state.round !== round || state.finalized) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (state.votedCount < state.totalCount && nowSeconds <= state.roundDeadline) return; // still collecting votes

    try {
      await this.onchainState.finalizeVoteRound(roomId);
    } catch (e: any) {
      this.logger.warn(`Room ${roomId}: finalize_vote_round not ready yet: ${e.message}`);
      return;
    }

    const { yesCount, totalCount, passed } = state;
    this.logger.log(`Room ${roomId}: vote round ${round} complete — ${yesCount}/${totalCount} YES (${passed ? 'cutting one more' : 'locked in'})`);
    this.events.emit(GACHA_EVENTS.ROOM_VOTE_RESULT, { roomId, round, yesCount, totalCount, passed });

    if (!passed) {
      await this.finalizeBuybackSettlement(roomId);
      return;
    }

    const db = this.supabase.getClient();
    this.vrf
      .requestRandomness(`${roomId}:vote:${round}`)
      .then(({ slot }) => db.from('gacha_rooms').update({ vrf_requested_at: new Date().toISOString(), vrf_request_slot: slot }).eq('id', roomId))
      .catch((e: any) => this.logger.error(`Room ${roomId}: vote-cut VRF request failed (will retry via cron): ${e.message}`));
  }

  /** Cron entrypoint — for every room in 'voting': if a cut draw is in flight (vrf_requested_at
   *  set), advance it; otherwise we're still collecting votes, so just check completion (the
   *  on-chain path enforces the 30s deadline itself via round_deadline; the in-memory path needs
   *  the separate maybeTimeoutVoteRound check). */
  async advanceVotingRooms(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: rooms } = await db.from('gacha_rooms').select('id, vote_round, vrf_requested_at').eq('status', 'voting');
    for (const room of rooms ?? []) {
      if (room.vrf_requested_at) {
        await this.resolveVoteCutDraw(room.id, room.vote_round).catch((e) => this.logger.error(`Room ${room.id}: vote-cut draw advance failed: ${e.message}`));
      } else if (this.onchainVoteStateEnabled) {
        await this.withVoteLock(room.id, () => this.checkVoteRoundCompleteOnchain(room.id, room.vote_round)).catch((e) => this.logger.error(`Room ${room.id}: vote completion check failed: ${e.message}`));
      } else {
        await this.maybeTimeoutVoteRound(room.id, room.vote_round).catch((e) => this.logger.error(`Room ${room.id}: vote timeout check failed: ${e.message}`));
      }
    }
  }

  /** A human who never votes can't hang the room forever — 30s after a round starts, anyone still
   *  missing a vote is counted as NO (the safer default: it never risks money on an unclicked
   *  action) and the round re-checks completion immediately. */
  private async maybeTimeoutVoteRound(roomId: string, round: number): Promise<void> {
    const startedAt = this.voteRoundStartedAt.get(roomId);
    if (!startedAt || Date.now() - startedAt < this.VOTE_ROUND_MS) return;

    return this.withVoteLock(roomId, async () => {
      const survivors = await this.getSurvivors(roomId);
      let tally = this.voteByRoom.get(roomId);
      if (!tally) { tally = new Map(); this.voteByRoom.set(roomId, tally); }
      let changed = false;
      for (const p of survivors) {
        if (!tally.has(p.user_id)) { tally.set(p.user_id, false); changed = true; }
      }
      if (changed) this.logger.log(`Room ${roomId}: vote round ${round} timed out — auto-voting NO for stragglers`);
      await this.checkVoteRoundComplete(roomId, round);
    });
  }

  /** Once this round's VRF draw resolves: picks exactly one random survivor via the same
   *  selectRandomWinners helper (count=1), marks them excluded, resets the VRF columns for the
   *  next round (or leaves them clear if settling), and either starts the next round or — once
   *  only 1 survivor remains — settles, matching the "voting can go all the way to a lone
   *  winner" rule (see PLAN doc). */
  private async resolveVoteCutDraw(roomId: string, round: number): Promise<void> {
    const randomnessHex = await this.pollOrRequestVrf(roomId, `${roomId}:vote:${round}`);
    if (!randomnessHex) return;

    const db = this.supabase.getClient();
    const survivors = await this.getSurvivors(roomId);
    if (survivors.length <= 1) { await this.finalizeBuybackSettlement(roomId); return; } // guard only — shouldn't happen

    const [victimUserId] = selectRandomWinners(survivors.map((p) => p.user_id), randomnessHex, 1);
    const victim = survivors.find((p) => p.user_id === victimUserId)!;
    await db.from('gacha_room_participants').update({ excluded: true }).eq('id', victim.id);
    this.logger.log(`Room ${roomId}: vote round ${round} cut seat ${victim.seat_number}`);
    this.events.emit(GACHA_EVENTS.ROOM_VOTE_CUT, { roomId, round, seatNumber: victim.seat_number });

    this.voteByRoom.delete(roomId);
    this.voteRoundStartedAt.delete(roomId);
    await db.from('gacha_rooms').update({
      vrf_requested_at: null, vrf_randomness: null, vrf_request_slot: null, vrf_fulfilled_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    const remaining = survivors.length - 1;
    if (remaining <= 1) {
      await this.finalizeBuybackSettlement(roomId);
    } else {
      const nextRound = round + 1;
      await db.from('gacha_rooms').update({ vote_round: nextRound, updated_at: new Date().toISOString() }).eq('id', roomId);
      await this.startVoteRound(roomId, nextRound);
    }
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
    const files = nftWon.content?.files ?? [];
    const frontFile = files.find((f) => f.uri?.includes('/front/')) ?? files[0];
    const backFile = files.find((f) => f.uri?.includes('/back/')) ?? files[1];
    const nftMetadata: NftMetadata = {
      mint: mint ?? undefined,
      name: nftWon.content?.metadata?.name,
      image: nftWon.content?.links?.image ?? frontFile?.uri,
      backImage: backFile?.uri,
      insuredValueUsdc: nftWon.content?.metadata?.insuredValue ? Number(nftWon.content.metadata.insuredValue) : undefined,
      attributes: nftWon.content?.metadata?.attributes,
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

    // Pack Party flow: the rip happens BEFORE exclusion now (not after, like the previous
    // session's version) — the room goes straight into the exclusion draw once opened, running
    // concurrently with whatever ready-gate/reveal-animation time clients spend watching the rip
    // client-side, so the draw is usually already resolved by the time players click through.
    await db.from('gacha_rooms').update({
      nft_metadata: nftMetadata,
      rarity,
      open_tx_sig: opened.transactionSignature ?? null,
      buyback_amount_usdc: buybackAmountUsdc,
      status: 'excluding',
      opened_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    this.logger.log(`Room ${roomId}: opened rarity=${rarity} buyback=$${buybackAmountUsdc} — exclusion draw starting`);
    this.events.emit(GACHA_EVENTS.ROOM_OPENED, { roomId, nftMetadata, rarity, buybackAmountUsdc, bidWindowEndsAt: null });

    // Fire-and-forget — same posture as every other multi-second on-chain step in this flow.
    // advanceExcludingRooms's cron sweep carries the poll-to-fulfillment step forward regardless.
    this.vrf
      .requestRandomness(roomId)
      .then(({ slot }) => db.from('gacha_rooms').update({ vrf_requested_at: new Date().toISOString(), vrf_request_slot: slot }).eq('id', roomId))
      .catch((e: any) => this.logger.error(`Room ${roomId}: VRF request failed (will retry via cron): ${e.message}`));
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

  /** Dev-only escape hatch for the exclusion draw, same reasoning as devForceSettleRoom: the
   *  cron sweep that advances 'excluding' rooms is hard-gated to NODE_ENV=production, so a local
   *  dev room would otherwise sit mid-draw forever. Loops advanceExclusionDraw the same way
   *  giveaways' forceRunDrawNow loops its own VRF advance — real on-chain VRF fulfillment (~2-4s
   *  observed) can't be skipped even when forced, only waited out faster than a 15s cron tick. */
  async devForceAdvanceExcluding(roomId: string): Promise<{ status: string }> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('Force-advance is not available in production');
    }
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'excluding') throw new BadRequestException(`Room isn't mid-exclusion-draw (status: ${room.status})`);

    let status = room.status;
    for (let i = 0; i < 15 && status === 'excluding'; i++) {
      await this.advanceExclusionDraw(roomId);
      const { data: after } = await db.from('gacha_rooms').select('status').eq('id', roomId).single();
      status = after?.status ?? status;
      if (status === 'excluding') await new Promise((r) => setTimeout(r, 1000));
    }
    return { status };
  }

  /** Dev-only escape hatch for voting rounds, same reasoning as devForceAdvanceExcluding. If the
   *  room is still collecting votes, forces the 30s timeout to fire immediately (auto-NO for
   *  anyone missing) instead of waiting it out; if a cut draw is already in flight, loops it to
   *  resolution the same way. Call it repeatedly to force through several rounds in a row. */
  async devForceAdvanceVoting(roomId: string): Promise<{ status: string }> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('Force-advance is not available in production');
    }
    const db = this.supabase.getClient();
    const { data: room } = await db.from('gacha_rooms').select('id, status, vote_round, vrf_requested_at').eq('id', roomId).maybeSingle();
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'voting') throw new BadRequestException(`Room isn't mid-voting (status: ${room.status})`);

    if (!room.vrf_requested_at) {
      this.voteRoundStartedAt.set(roomId, 0); // force the 30s window to already be elapsed
      await this.maybeTimeoutVoteRound(roomId, room.vote_round);
    }

    let status = room.status;
    for (let i = 0; i < 15 && status === 'voting'; i++) {
      const { data: current } = await db.from('gacha_rooms').select('status, vote_round, vrf_requested_at').eq('id', roomId).single();
      if (current?.vrf_requested_at) await this.resolveVoteCutDraw(roomId, current.vote_round);
      const { data: after } = await db.from('gacha_rooms').select('status').eq('id', roomId).single();
      status = after?.status ?? status;
      if (status === 'voting') await new Promise((r) => setTimeout(r, 1000));
    }
    return { status };
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
    // Atomic claim — settlement can now be reached from two independent paths (a vote round not
    // passing, or voting cutting all the way down to 1 survivor), which can race a cron tick
    // against a real-time vote. This WHERE-gated update ensures only the first caller actually
    // proceeds with the real buyback tx — same "claim before doing the expensive work" posture
    // the seat-cap trigger uses at join time. Reuses 'settling' for its original meaning too (a
    // brief holding status while the buyback tx confirms).
    const { data: claimed } = await db.from('gacha_rooms').update({ status: 'settling', updated_at: new Date().toISOString() }).eq('id', roomId).in('status', ['excluding', 'voting']).select('id');
    if (!claimed?.length) return;

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

    await this.splitPayoutAndMarkSettled(roomId, receivedUnits, { buybackTxSig });
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
    await this.splitPayoutAndMarkSettled(roomId, receivedUnits, { winningBidId: bidId, nftTransferTxSig });
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

  /** Splits `totalUnits` evenly across the room's SURVIVING (non-excluded) participants only —
   *  any leftover dust from integer division goes to the first survivor by seat number, same
   *  "someone has to get the extra cent" tie-break other split logic in this codebase uses.
   *  Excluded participants are recorded with payout_usdc = 0 (not left null), so the settled UI
   *  can tell "excluded, nothing to claim" apart from "payout not computed yet". Does NOT push any
   *  money yet — see claimPayout for why (private/public is each participant's own choice, made
   *  when they claim, not decided for them at settlement time). */
  private async splitPayoutAndMarkSettled(roomId: string, totalUnits: bigint, extra: { buybackTxSig?: string; winningBidId?: string; nftTransferTxSig?: string }): Promise<void> {
    const db = this.supabase.getClient();
    const { data: participants } = await db.from('gacha_room_participants').select('id, seat_number, excluded').eq('room_id', roomId).order('seat_number', { ascending: true });
    const rows = participants ?? [];
    const survivors = rows.filter((p: any) => !p.excluded);
    // Guard against the pathological case of everyone somehow being excluded (exclusion_count
    // misconfigured >= seats) — falls back to splitting across everyone rather than dividing by 0.
    const payoutRows = survivors.length ? survivors : rows;
    const shareUnits = totalUnits / BigInt(payoutRows.length || 1);
    const dustUnits = totalUnits - shareUnits * BigInt(payoutRows.length || 1);
    const dustSeat = payoutRows[0]?.seat_number;

    for (const p of rows) {
      if (!payoutRows.includes(p)) {
        await db.from('gacha_room_participants').update({ payout_usdc: 0 }).eq('id', p.id);
        continue;
      }
      const units = shareUnits + (p.seat_number === dustSeat ? dustUnits : 0n);
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

    this.logger.log(`Room ${roomId}: settled, ${payoutRows.length} payouts of ~${Number(shareUnits) / 1_000_000} USDC each (${rows.length - payoutRows.length} excluded)`);
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
      .select('id, config_key, pack_type, seats, entry_usdc, exclusion_count, vote_round, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(`Failed to load gacha rooms: ${error.message}`);
    const roomIds = (data ?? []).map((r: any) => r.id);
    const counts = await this.countParticipantsByRoom(roomIds);
    return {
      data: (data ?? []).map((r: any) => ({
        id: r.id, configKey: r.config_key, packType: r.pack_type, seats: r.seats, entryUsdc: Number(r.entry_usdc),
        exclusionCount: r.exclusion_count, voteRound: r.vote_round,
        status: r.status, seatsFilled: counts[r.id] ?? 0, nftMetadata: r.nft_metadata, rarity: r.rarity,
        buybackAmountUsdc: r.buyback_amount_usdc !== null ? Number(r.buyback_amount_usdc) : null,
        bidWindowEndsAt: r.bid_window_ends_at, createdAt: r.created_at,
      })),
      total: count ?? 0, page, limit: pageSize,
    };
  }
}
