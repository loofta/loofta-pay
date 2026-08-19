import { randomBytes, randomUUID } from 'crypto';
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
import { CollectorCryptApiError, CollectorCryptClient, CollectorCryptPackType, GeneratePackResponse, NftMetadata, OpenPackResponse, PackRarityTier } from './collectorcrypt.client';
import { GACHA_EVENTS } from './gacha.events';
import { GachaVrfService } from './gacha-vrf.service';
import { GACHA_ROOM_PHASE, GachaOnchainStateService, type GachaRoomPhase } from './gacha-onchain-state.service';
import { calculateGachaPayoutUnits } from './gacha-payout';
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

/** The transaction was accepted by RPC, but its final outcome could not be observed. Callers
 * must keep their idempotency lock instead of blindly retrying a potentially successful send. */
class SubmittedTransactionUnconfirmedError extends Error {
  constructor(public readonly signature: string, message: string) {
    super(message);
    this.name = 'SubmittedTransactionUnconfirmedError';
  }
}

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
  name?: string;
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
  isPrivate?: boolean;
}

export interface WaitingRoomSummary {
  id: string;
  name: string;
  configKey: string;
  seats: number;
  entryUsdc: number;
  seatsFilled: number;
  isPrivate: boolean;
  /** Bearer invite token. Returned only to the creator immediately after room creation. */
  inviteCode?: string | null;
  createdAt: string;
  participants: Array<{ seatNumber: number; mascotKey: string | null }>;
}

export interface CurrentWaitingRoomSummary extends WaitingRoomSummary {
  isCreator: boolean;
  hasSeat: boolean;
  /** An unseated creator may cancel only while nobody has paid into the room. */
  canCancel: boolean;
}

interface ExistingWaitingRoom {
  id: string;
  entryUsdc: number;
  isCreator: boolean;
  hasSeat: boolean;
  createdAt: string;
}

export interface ActiveRoomSummary {
  id: string;
  name: string;
  configKey: string;
  seats: number;
  seatsFilled: number;
  status: string;
  createdAt: string;
  participants: Array<{ seatNumber: number; mascotKey: string | null }>;
}

export interface RunItBackResult {
  groupId: string;
  claimDeadline: string;
  inviteCode: string | null;
  mascotKey: string | null;
  room: WaitingRoomSummary;
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

  private get onchainGameplayStateEnabled(): boolean {
    return this.config.get<string>('GACHA_ONCHAIN_READY_STATE') === 'true'
      || this.config.get<string>('GACHA_ONCHAIN_VOTE_STATE') === 'true'
      || this.config.get<string>('GACHA_ONCHAIN_LIFECYCLE_STATE') === 'true';
  }

  private async syncOnchainPhase(roomId: string, seats: number, phase: GachaRoomPhase): Promise<void> {
    if (!this.onchainGameplayStateEnabled) return;
    try {
      await this.onchainState.ensureRoomDelegated(roomId, seats);
      await this.onchainState.setPhase(roomId, phase);
    } catch (e: any) {
      this.logger.warn(`Room ${roomId}: failed to sync ER phase ${phase}: ${e.message}`);
    }
  }

  private async syncOnchainInitialExclusion(roomId: string, seats: number, excludedSeatNumbers: number[]): Promise<void> {
    if (!this.onchainGameplayStateEnabled) return;
    try {
      await this.onchainState.ensureRoomDelegated(roomId, seats);
      await this.onchainState.recordInitialExclusion(roomId, excludedSeatNumbers);
    } catch (e: any) {
      this.logger.warn(`Room ${roomId}: failed to sync ER initial exclusion: ${e.message}`);
    }
  }

  private async syncOnchainVoteCut(roomId: string, round: number, seatNumber: number): Promise<void> {
    if (!this.onchainGameplayStateEnabled) return;
    const seats = await this.getRoomSeats(roomId);
    if (seats === null) return;
    try {
      await this.onchainState.ensureRoomDelegated(roomId, seats);
      await this.onchainState.recordVoteCut(roomId, round, seatNumber);
    } catch (e: any) {
      this.logger.warn(`Room ${roomId}: failed to sync ER vote cut: ${e.message}`);
    }
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
      .in('status', ['waiting', 'purchasing', 'opening', 'excluding', 'voting', 'bidding', 'settling'])
      .eq('is_private', false)
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

  /** Public lobby data for one room size/config. Private rooms are deliberately absent; invite
   *  links use getWaitingRoomByInviteCode instead of entering this public browser. */
  async listPublicWaitingRooms(configKey: string): Promise<WaitingRoomSummary[]> {
    await this.getConfig(configKey);
    const db = this.supabase.getClient();
    const { data: rooms, error } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, seats, entry_usdc, is_private, created_at')
      .eq('config_key', configKey)
      .eq('status', 'waiting')
      .eq('is_private', false)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to list waiting gacha rooms: ${error.message}`);

    const summaries = await this.hydrateWaitingRoomSummaries(rooms ?? []);
    return summaries
      .filter((room) => room.seatsFilled < room.seats)
      .sort((a, b) => b.seatsFilled - a.seatsFilled || a.createdAt.localeCompare(b.createdAt));
  }

  /** Public games that have already started and can be watched. Waiting rooms belong to the
   * join browser, while terminal rooms are history rather than a live spectator destination.
   * Private rooms are excluded at the query boundary so their existence is never disclosed. */
  async listActivePublicRooms(configKey: string): Promise<ActiveRoomSummary[]> {
    await this.getConfig(configKey);
    const db = this.supabase.getClient();
    const activeStatuses = ['purchasing', 'opening', 'excluding', 'voting', 'bidding', 'settling'];
    const { data: rooms, error } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, seats, status, created_at')
      .eq('config_key', configKey)
      .eq('is_private', false)
      .in('status', activeStatuses)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list active gacha rooms: ${error.message}`);
    if (!rooms?.length) return [];

    const roomIds = rooms.map((room: any) => room.id);
    const { data: participantRows, error: participantError } = await db
      .from('gacha_room_participants')
      .select('room_id, seat_number, mascot_key')
      .in('room_id', roomIds)
      .order('seat_number', { ascending: true });
    if (participantError) throw new Error(`Failed to load active room participants: ${participantError.message}`);

    const participantsByRoom: Record<string, Array<{ seatNumber: number; mascotKey: string | null }>> = {};
    for (const participant of participantRows ?? []) {
      (participantsByRoom[participant.room_id] ??= []).push({
        seatNumber: participant.seat_number,
        mascotKey: participant.mascot_key ?? null,
      });
    }

    return rooms.map((room: any) => {
      const participants = participantsByRoom[room.id] ?? [];
      return {
        id: room.id,
        name: room.name,
        configKey: room.config_key,
        seats: room.seats,
        seatsFilled: participants.length,
        status: room.status,
        createdAt: room.created_at,
        participants,
      };
    });
  }

  /**
   * Returns a display hint for the create form. The database RPC remains the source of truth and
   * allocates the number atomically; this endpoint only lets the UI show the right default before
   * the user submits the form.
   */
  async getNextRoomNumber(configKey: string): Promise<{ roomNumber: number }> {
    await this.getConfig(configKey);
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('gacha_rooms')
      .select('room_number')
      .eq('config_key', configKey)
      .order('room_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to load next Gacha room number: ${error.message}`);
    return { roomNumber: Number(data?.room_number ?? 0) + 1 };
  }

  /** The caller's current waiting-room relationship for one size. Unlike the public browser,
   * this also recovers private rooms and rooms the caller created but has not paid to join yet. */
  async getCurrentWaitingRoom(configKey: string, userId: string): Promise<CurrentWaitingRoomSummary | null> {
    await this.getConfig(configKey);
    const existing = await this.findExistingWaitingRoomForUser(configKey, userId);
    if (!existing) return null;
    const room = await this.getWaitingRoomSummary(existing.id, userId, true);
    return {
      ...room,
      isCreator: existing.isCreator,
      hasSeat: existing.hasSeat,
      canCancel: existing.isCreator && !existing.hasSeat && room.seatsFilled === 0,
    };
  }

  /** Creates a distinct room even when another room of the same config has open seats. Stable
   *  numbering and the insert happen in one database function under a per-config lock. */
  async createWaitingRoom(
    configKey: string,
    userId: string,
    name: string | undefined,
    isPrivate: boolean,
  ): Promise<WaitingRoomSummary> {
    await this.getConfig(configKey);
    const normalizedName = name?.trim();
    if (normalizedName !== undefined && !normalizedName) throw new BadRequestException('Room name cannot be empty');
    if (normalizedName && normalizedName.length > 24) throw new BadRequestException('Room name must be 24 characters or fewer');

    const existing = await this.findExistingWaitingRoomForUser(configKey, userId);
    if (existing) {
      // The public browser deliberately hides private rooms, but the duplicate-seat guard
      // still needs to give the owner a way back to their existing room. Return the same
      // owner-authorized summary used by the room UI; never expose this to another user.
      const existingRoom = await this.getCurrentWaitingRoom(configKey, userId);
      throw new BadRequestException({
        code: 'ALREADY_IN_WAITING_ROOM',
        message: existing.hasSeat
          ? 'You already have a seat in a waiting room for this size'
          : 'You already created a waiting room for this size',
        room: existingRoom,
      });
    }

    // The token is generated server-side and is only returned to the creator. It is a bearer
    // capability, so it must never be derived from a room id or exposed in the public lobby.
    const inviteCode = isPrivate ? randomBytes(24).toString('base64url') : null;
    const db = this.supabase.getClient();
    const { data: roomId, error } = await db.rpc('gacha_create_waiting_room', {
      p_config_key: configKey,
      p_created_by_user_id: userId,
      p_room_name: normalizedName || null,
      p_is_private: isPrivate,
      p_invite_code: inviteCode,
    });
    if (error) {
      if (error.message?.includes('already have a waiting room')) {
        // The database lock is the final race guard. If a concurrent request won after the
        // preflight check, recover that room into the same structured response the UI expects.
        const existingRoom = await this.getCurrentWaitingRoom(configKey, userId);
        if (existingRoom) {
          throw new BadRequestException({
            code: 'ALREADY_IN_WAITING_ROOM',
            message: existingRoom.hasSeat
              ? 'You already have a seat in a waiting room for this size'
              : 'You already created a waiting room for this size',
            room: existingRoom,
          });
        }
        throw new BadRequestException('You already have a waiting room for this size');
      }
      throw new Error(`Failed to create gacha room: ${error.message}`);
    }
    if (!roomId) throw new Error('Failed to create gacha room: No room returned');

    return this.getWaitingRoomSummary(String(roomId), userId);
  }

  private async getWaitingRoomSummary(roomId: string, viewerUserId?: string, allowFull = false): Promise<WaitingRoomSummary> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, seats, entry_usdc, is_private, created_by_user_id, invite_code, created_at, status')
      .eq('id', roomId)
      .maybeSingle();
    if (error || !room || room.status !== 'waiting') throw new NotFoundException('Waiting room not found');
    let canViewPrivateRoom = !room.is_private || room.created_by_user_id === viewerUserId;
    if (!canViewPrivateRoom && viewerUserId) {
      const { data: participant } = await db
        .from('gacha_room_participants')
        .select('id')
        .eq('room_id', roomId)
        .eq('user_id', viewerUserId)
        .maybeSingle();
      canViewPrivateRoom = !!participant;
    }
    if (!canViewPrivateRoom) throw new NotFoundException('Waiting room not found');
    const [summary] = await this.hydrateWaitingRoomSummaries(
      [room],
      room.created_by_user_id === viewerUserId,
    );
    if (!summary || (!allowFull && summary.seatsFilled >= summary.seats)) throw new BadRequestException('This room is full');
    return summary;
  }

  private async hydrateWaitingRoomSummaries(rooms: any[], includeInviteCode = false): Promise<WaitingRoomSummary[]> {
    if (!rooms.length) return [];
    const db = this.supabase.getClient();
    const roomIds = rooms.map((room) => room.id);
    const { data: participantRows, error } = await db
      .from('gacha_room_participants')
      .select('room_id, seat_number, mascot_key')
      .in('room_id', roomIds)
      .order('seat_number', { ascending: true });
    if (error) throw new Error(`Failed to load waiting room participants: ${error.message}`);

    const participantsByRoom: Record<string, Array<{ seatNumber: number; mascotKey: string | null }>> = {};
    for (const participant of participantRows ?? []) {
      (participantsByRoom[participant.room_id] ??= []).push({
        seatNumber: participant.seat_number,
        mascotKey: participant.mascot_key ?? null,
      });
    }

    return rooms.map((room) => {
      const participants = participantsByRoom[room.id] ?? [];
      return {
        id: room.id,
        name: room.name,
        configKey: room.config_key,
        seats: room.seats,
        entryUsdc: Number(room.entry_usdc),
        seatsFilled: participants.length,
        isPrivate: !!room.is_private,
        ...(includeInviteCode ? { inviteCode: room.invite_code ?? null } : {}),
        createdAt: room.created_at,
        participants,
      };
    });
  }

  /** Safe bearer-link preview. It exposes only the same lobby fields as a public room row and
   * never echoes the invite code back to the browser. The caller still needs an authenticated
   * Privy token before the room detail or payment endpoints can be used. */
  async getWaitingRoomByInviteCode(inviteCode: string): Promise<WaitingRoomSummary> {
    const normalized = inviteCode.trim();
    if (!normalized) throw new NotFoundException('Room not found');
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, seats, entry_usdc, is_private, created_at, status')
      .eq('invite_code', normalized)
      .eq('is_private', true)
      .eq('status', 'waiting')
      .maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');
    const [summary] = await this.hydrateWaitingRoomSummaries([room]);
    if (!summary || summary.seatsFilled >= summary.seats) throw new BadRequestException('This room is full');
    return summary;
  }

  /**
   * Idempotently create (or recover) the one next waiting room owned by a settled source room.
   * This endpoint only allocates the shared destination; each player still explicitly pays a
   * fresh entry through the normal room join flow. The database RPC serializes concurrent clicks
   * and excludes synthetic bot seats from the rematch membership list.
   */
  async runItBack(sourceRoomId: string, userId: string): Promise<RunItBackResult> {
    const db = this.supabase.getClient();
    const { data: source, error: sourceError } = await db
      .from('gacha_rooms')
      .select('id, is_private, status')
      .eq('id', sourceRoomId)
      .maybeSingle();
    if (sourceError || !source) throw new NotFoundException('Room not found');

    const inviteCode = source.is_private ? randomBytes(24).toString('base64url') : null;
    const { data, error } = await db.rpc('gacha_create_rematch_group', {
      p_source_room_id: sourceRoomId,
      p_requesting_user_id: userId,
      p_invite_code: inviteCode,
      p_claim_window_seconds: 60,
    });
    if (error) {
      const message = error.message ?? '';
      if (message.includes('not settled')) throw new BadRequestException('This room is not settled yet');
      if (message.includes('Only a room participant') || message.includes('not part of this rematch')) {
        throw new NotFoundException('Room not found');
      }
      throw new Error(`Failed to create rematch room: ${message}`);
    }

    const row = (Array.isArray(data) ? data[0] : data) as any;
    if (!row?.next_room_id || !row?.group_id) throw new Error('Failed to create rematch room: no room returned');

    const { data: nextRoom, error: nextRoomError } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, seats, entry_usdc, is_private, created_at, status, invite_code')
      .eq('id', row.next_room_id)
      .maybeSingle();
    if (nextRoomError || !nextRoom || nextRoom.status !== 'waiting') {
      throw new Error('Failed to load rematch room');
    }
    const [room] = await this.hydrateWaitingRoomSummaries([nextRoom], !!nextRoom.is_private);
    if (!room) throw new Error('Failed to load rematch room participants');

    const { data: sourceParticipant } = await db
      .from('gacha_room_participants')
      .select('mascot_key')
      .eq('room_id', sourceRoomId)
      .eq('user_id', userId)
      .maybeSingle();

    return {
      groupId: String(row.group_id),
      claimDeadline: String(row.claim_deadline),
      inviteCode: nextRoom.is_private ? (nextRoom.invite_code ?? null) : null,
      mascotKey: sourceParticipant?.mascot_key ?? null,
      room,
    };
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
  async getRoomDetail(roomId: string, userId: string, inviteCode?: string): Promise<{
    room: RoomSummary;
    myParticipant: { seatNumber: number; payoutUsdc: number | null; payoutIsPrivate: boolean | null; claimed: boolean; claimPending: boolean; mascotKey: string | null; mascotLocked: boolean; excluded: boolean } | null;
    bestBid: { amountUsdc: number } | null;
    pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
    participants: Array<{ seatNumber: number; username: string | null; isMe: boolean; mascotKey: string | null; mascotLocked: boolean; excluded: boolean }>;
  }> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, name, config_key, pack_type, seats, entry_usdc, exclusion_count, vote_round, status, nft_metadata, rarity, buyback_amount_usdc, bid_window_ends_at, pending_bid_id, created_at, is_private, created_by_user_id, invite_code')
      .eq('id', roomId)
      .maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');

    const counts = await this.countParticipantsByRoom([roomId]);
    const { data: mine } = await db.from('gacha_room_participants').select('seat_number, payout_usdc, payout_is_private, payout_tx_sig, payout_claim_token, mascot_key, mascot_locked_at, excluded').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (room.is_private && room.created_by_user_id !== userId && room.invite_code !== inviteCode && !mine) {
      // Do not reveal whether a private room exists to an authenticated user without the
      // creator identity, an existing seat, or the exact bearer invite code.
      throw new NotFoundException('Room not found');
    }
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
        id: room.id, name: room.name ?? undefined, configKey: room.config_key, packType: room.pack_type, seats: room.seats, entryUsdc: Number(room.entry_usdc),
        exclusionCount: room.exclusion_count, voteRound: room.vote_round,
        status: room.status, seatsFilled: counts[roomId] ?? 0, nftMetadata: room.nft_metadata, rarity: room.rarity,
        buybackAmountUsdc: room.buyback_amount_usdc !== null ? Number(room.buyback_amount_usdc) : null,
        bidWindowEndsAt: room.bid_window_ends_at, createdAt: room.created_at,
        isPrivate: !!room.is_private,
      },
      myParticipant: mine
        ? {
            seatNumber: mine.seat_number,
            payoutUsdc: mine.payout_usdc !== null ? Number(mine.payout_usdc) : null,
            payoutIsPrivate: mine.payout_is_private,
            claimed: !!mine.payout_tx_sig,
            claimPending: !!mine.payout_claim_token && !mine.payout_tx_sig,
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

  /** Explicit room path used by the LOO-6 lobby. The client chooses the room id; the backend
   *  verifies its config/status/visibility/capacity before constructing a memo-bound payment. */
  async buildJoinTxForRoom(roomId: string, userId: string, inviteCode?: string): Promise<{ txBase64: string | null; roomId: string; entryUsdc: number; alreadyJoined?: boolean }> {
    const requestedRoom = await this.getJoinableRoom(roomId, userId, inviteCode);
    const existing = await this.findExistingWaitingRoomForUser(requestedRoom.configKey, userId);
    if (existing?.id === requestedRoom.id && existing.hasSeat) {
      return { txBase64: null, roomId: existing.id, entryUsdc: existing.entryUsdc, alreadyJoined: true };
    }
    if (existing && existing.id !== requestedRoom.id) {
      const existingRoom = await this.getCurrentWaitingRoom(requestedRoom.configKey, userId);
      throw new BadRequestException({
        code: 'ALREADY_IN_DIFFERENT_WAITING_ROOM',
        message: 'Leave your current waiting room before joining another one',
        room: existingRoom,
      });
    }

    await this.assertRoomHasOpenSeat(requestedRoom, userId);
    return this.buildEntryPaymentTx(requestedRoom, userId);
  }

  async leaveWaitingRoom(roomId: string, userId: string): Promise<{
    roomId: string;
    seatsFilled: number;
    seats: number;
    roomCancelled: boolean;
    entryRefunded: false;
  }> {
    const db = this.supabase.getClient();
    const { data, error } = await db.rpc('gacha_leave_waiting_room', {
      p_room_id: roomId,
      p_user_id: userId,
    });
    if (error) {
      const message = error.message ?? '';
      if (message.includes('not found')) throw new NotFoundException('Room not found');
      if (message.includes('do not have a seat')) throw new BadRequestException('You do not have a seat in this room');
      if (message.includes('has paid participants')) {
        throw new BadRequestException('This room already has paid players and can no longer be cancelled');
      }
      if (message.includes('already started') || message.includes('can no longer be left')) {
        throw new BadRequestException('This room has already started and can no longer be left');
      }
      throw new Error(`Failed to leave Gacha room: ${message}`);
    }

    const result = data as {
      roomId: string;
      seatsFilled: number;
      seats: number;
      roomCancelled: boolean;
      entryRefunded: false;
    };
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, {
      roomId,
      seatsFilled: result.seatsFilled,
      seats: result.seats,
      status: result.roomCancelled ? 'cancelled' : 'waiting',
    });
    return result;
  }

  private async findExistingWaitingRoomForUser(
    configKey: string,
    userId: string,
  ): Promise<ExistingWaitingRoom | null> {
    const db = this.supabase.getClient();
    const { data: myRoomIds, error: participantError } = await db.from('gacha_room_participants').select('room_id').eq('user_id', userId);
    if (participantError) throw new Error(`Failed to load existing Gacha seats: ${participantError.message}`);

    const participantRoomIds = new Set((myRoomIds ?? []).map((row: any) => String(row.room_id)));
    const { data: ownedRoom, error: ownedError } = await db
      .from('gacha_rooms')
      .select('id, entry_usdc, created_at')
      .eq('config_key', configKey)
      .eq('status', 'waiting')
      .eq('created_by_user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ownedError) throw new Error(`Failed to load creator-owned Gacha room: ${ownedError.message}`);

    let participantRoom: any = null;
    if (participantRoomIds.size) {
      const { data, error } = await db
        .from('gacha_rooms')
        .select('id, entry_usdc, created_at')
        .in('id', Array.from(participantRoomIds))
        .eq('config_key', configKey)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to load existing Gacha seat: ${error.message}`);
      participantRoom = data;
    }

    const candidates = [ownedRoom, participantRoom].filter(Boolean).sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    const existing = candidates[0];
    if (!existing) return null;
    return {
      id: existing.id,
      entryUsdc: Number(existing.entry_usdc),
      isCreator: ownedRoom?.id === existing.id,
      hasSeat: participantRoomIds.has(String(existing.id)),
      createdAt: existing.created_at,
    };
  }

  private async getJoinableRoom(
    roomId: string,
    userId: string,
    inviteCode?: string,
  ): Promise<{ id: string; configKey: string; seats: number; entryUsdc: number; isPrivate: boolean }> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db
      .from('gacha_rooms')
      .select('id, config_key, seats, entry_usdc, status, is_private, created_by_user_id, invite_code')
      .eq('id', roomId)
      .maybeSingle();
    if (error || !room) throw new NotFoundException('Room not found');
    if (room.status !== 'waiting') throw new BadRequestException(`Room is no longer accepting joins (status: ${room.status})`);
    if (room.is_private && room.created_by_user_id !== userId && room.invite_code !== inviteCode) {
      const { data: participant, error: participantError } = await db
        .from('gacha_room_participants')
        .select('id')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .maybeSingle();
      if (participantError || !participant) throw new NotFoundException('Room not found');
    }

    return { id: room.id, configKey: room.config_key, seats: room.seats, entryUsdc: Number(room.entry_usdc), isPrivate: !!room.is_private };
  }

  private async assertRoomHasOpenSeat(room: { id: string; seats: number; isPrivate?: boolean }, userId?: string): Promise<void> {
    const seatsFilled = await this.getParticipantCount(room.id);
    if (seatsFilled >= room.seats) throw new BadRequestException('This room just filled up — choose another room');

    // The database trigger remains authoritative for races. This read-only check keeps a public
    // newcomer from signing a payment that will immediately be refunded while the original
    // rematch members' short reservation window is still open.
    if (!room.isPrivate && userId) {
      const db = this.supabase.getClient();
      const { data: group } = await db
        .from('gacha_rematch_groups')
        .select('id, claim_deadline')
        .eq('next_room_id', room.id)
        .maybeSingle();
      if (group && new Date(group.claim_deadline).getTime() > Date.now()) {
        const { data: member } = await db
          .from('gacha_rematch_members')
          .select('user_id')
          .eq('group_id', group.id)
          .eq('user_id', userId)
          .maybeSingle();
        if (!member) {
          const { data: members } = await db
            .from('gacha_rematch_members')
            .select('user_id')
            .eq('group_id', group.id);
          const { data: joined } = await db
            .from('gacha_room_participants')
            .select('user_id')
            .eq('room_id', room.id);
          const joinedUsers = new Set((joined ?? []).map((row: any) => row.user_id));
          const pending = (members ?? []).filter((row: any) => !joinedUsers.has(row.user_id)).length;
          if (seatsFilled + pending >= room.seats) {
            throw new BadRequestException('This rematch room is holding seats for the original group — try again shortly');
          }
        }
      }
    }
  }

  private async buildEntryPaymentTx(
    room: { id: string; entryUsdc: number },
    userId: string,
  ): Promise<{ txBase64: string; roomId: string; entryUsdc: number }> {

    // Never trust a client-supplied wallet for a treasury-funded transaction. The authenticated
    // Privy identity is the source of truth for both optional devnet funding and payment
    // verification, so a caller cannot use this endpoint as an arbitrary-wallet faucet.
    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.ensureDevnetTestFunds(userSolanaAddress, room.entryUsdc);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, fromPubkey);
    const toAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${room.id}`, 'utf8') }),
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, this.usdcMint),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(room.entryUsdc * 1_000_000)),
    ];

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({ payerKey: treasuryKeypair.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]);

    return { txBase64: Buffer.from(tx.serialize()).toString('base64'), roomId: room.id, entryUsdc: room.entryUsdc };
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

    // Auto-funding is an explicit local/dev convenience, never an implicit production faucet.
    // A shared dev deployment should leave this off and point testers at the documented faucet.
    if (this.config.get<string>('NODE_ENV') === 'production' || this.config.get<string>('GACHA_DEVNET_AUTO_FUND') !== 'true') {
      throw new BadRequestException(`Your Gacha devnet wallet needs at least ${minUsdc.toFixed(2)} USDC-Dev before joining`);
    }

    const treasuryKeypair = await this.getTreasuryKeypair();
    const fromAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const defaultTopUpUnits = BigInt(Math.round(DEVNET_TEST_TOPUP_USDC * 1_000_000));
    const topUpUnits = defaultTopUpUnits > minUnits - currentUnits ? defaultTopUpUnits : minUnits - currentUnits;

    const tx = new Transaction();
    tx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, ata, pubkey, this.usdcMint));
    tx.add(createTransferInstruction(fromAta, ata, treasuryKeypair.publicKey, topUpUnits));
    tx.feePayer = treasuryKeypair.publicKey;
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(treasuryKeypair);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await this.pollConfirmed(conn, sig);
    this.logger.log(`Devnet test top-up: sent ${Number(topUpUnits) / 1_000_000} USDC-Dev to ${userSolanaAddress} (sig=${sig})`);
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
    await this.pollConfirmed(conn, fundSig);

    const treasuryToAta = await getAssociatedTokenAddress(this.usdcMint, treasuryKeypair.publicKey);
    const joinTx = new Transaction();
    joinTx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${roomId}`, 'utf8') }));
    joinTx.add(createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, treasuryToAta, treasuryKeypair.publicKey, this.usdcMint));
    joinTx.add(createTransferInstruction(botAta, treasuryToAta, bot.publicKey, entryUnits));
    joinTx.feePayer = treasuryKeypair.publicKey;
    joinTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    joinTx.sign(treasuryKeypair, bot);
    const joinSig = await this.sendAndLog(conn, joinTx, `Room ${roomId}: bot ${botUserId} join tx`);
    await this.pollConfirmed(conn, joinSig);

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
  async confirmJoin(roomId: string, userId: string, paymentTxHash: string, mascotKey: string, inviteCode?: string): Promise<{ seatNumber: number; roomFilled: boolean }> {
    if (!(MASCOT_KEYS as readonly string[]).includes(mascotKey)) throw new BadRequestException('Unknown mascot');
    const db = this.supabase.getClient();
    const room = await this.getJoinableRoom(roomId, userId, inviteCode);

    const { data: existing } = await db.from('gacha_room_participants').select('id').eq('payment_tx_hash', paymentTxHash).maybeSingle();
    if (existing) throw new BadRequestException('This payment has already been used to join a room');
    const { data: departedPayment, error: departedPaymentError } = await db
      .from('gacha_room_departures')
      .select('participant_id')
      .eq('payment_tx_hash', paymentTxHash)
      .maybeSingle();
    if (departedPaymentError) throw new Error(`Failed to verify Gacha payment history: ${departedPaymentError.message}`);
    if (departedPayment) throw new BadRequestException('This payment has already been used to join a room');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.verifyOnChainPayment(paymentTxHash, room.entryUsdc, userSolanaAddress, `${ROOM_MEMO_PREFIX}${roomId}`);

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
      // A retry of the SAME confirmed payment may race its own first request. Treat the already-
      // inserted participant as idempotent success; never refund a payment that actually owns a
      // seat, or the caller would receive both the seat and their money back.
      const { data: paymentSeat } = await db.from('gacha_room_participants')
        .select('room_id, user_id, seat_number')
        .eq('payment_tx_hash', paymentTxHash)
        .maybeSingle();
      if (paymentSeat) {
        if (paymentSeat.room_id === roomId && paymentSeat.user_id === userId) {
          await this.maybeAdvanceToRipping(roomId);
          return { seatNumber: paymentSeat.seat_number, roomFilled: paymentSeat.seat_number === room.seats };
        }
        throw new BadRequestException('This payment has already been used to join a room');
      }

      // The payment is valid and reached the treasury, but the seat did not land (normally the
      // room filled in the build->sign->confirm window, or a second distinct payment raced for
      // the same user's one seat). Return it through an idempotent refund ledger.
      const refundTxSig = await this.refundFailedJoin(roomId, userId, paymentTxHash, room.entryUsdc, userSolanaAddress);
      throw new BadRequestException(`This room just filled up. Your entry payment was automatically refunded (${refundTxSig})`);
    }
    const seatNumber = inserted.seat_number;

    const roomFilled = seatNumber === room.seats;
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: seatNumber, seats: room.seats, status: 'waiting' });
    // In case this join was ALSO the last mascot lock needed (always true now, since mascots are
    // pre-chosen) — mirrors the same check bot joins already trigger.
    await this.maybeAdvanceToRipping(roomId);

    return { seatNumber, roomFilled };
  }

  private async refundFailedJoin(
    roomId: string,
    userId: string,
    paymentTxHash: string,
    amountUsdc: number,
    destination: string,
  ): Promise<string> {
    const db = this.supabase.getClient();
    const now = new Date().toISOString();
    const { data: created, error: createError } = await db.from('gacha_entry_refunds').insert({
      payment_tx_hash: paymentTxHash,
      room_id: roomId,
      user_id: userId,
      amount_usdc: amountUsdc,
      status: 'processing',
      updated_at: now,
    }).select('payment_tx_hash').maybeSingle();

    let acquired = !!created;
    if (createError && (createError as any).code !== '23505') {
      throw new Error(`Failed to create Gacha refund record: ${createError.message}`);
    }

    if (!acquired) {
      const { data: existing, error } = await db.from('gacha_entry_refunds')
        .select('status, refund_tx_sig')
        .eq('payment_tx_hash', paymentTxHash)
        .single();
      if (error || !existing) throw new Error(`Failed to load Gacha refund record: ${error?.message}`);
      if (existing.status === 'refunded' && existing.refund_tx_sig) return existing.refund_tx_sig;
      if (existing.status === 'processing') throw new BadRequestException('Your entry refund is already being processed');

      const { data: reclaimed, error: reclaimError } = await db.from('gacha_entry_refunds')
        .update({ status: 'processing', failure_reason: null, updated_at: now })
        .eq('payment_tx_hash', paymentTxHash)
        .eq('status', 'failed')
        .select('payment_tx_hash');
      if (reclaimError) throw new Error(`Failed to retry Gacha refund: ${reclaimError.message}`);
      acquired = !!reclaimed?.length;
    }

    if (!acquired) throw new BadRequestException('Your entry refund is already being processed');
    try {
      const refundTxSig = await this.sendPublicPayout(destination, amountUsdc);
      const { error } = await db.from('gacha_entry_refunds').update({
        status: 'refunded',
        refund_tx_sig: refundTxSig,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      }).eq('payment_tx_hash', paymentTxHash).eq('status', 'processing');
      if (error) this.logger.error(`Entry refund ${refundTxSig} sent for ${paymentTxHash} but could not be recorded: ${error.message}`);
      return refundTxSig;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // A submitted-but-unconfirmed refund may still land. Preserve `processing` so a retry
      // cannot send it twice; only definite pre-submit/on-chain failures become retryable.
      await db.from('gacha_entry_refunds').update({
        ...(e instanceof SubmittedTransactionUnconfirmedError ? {} : { status: 'failed' }),
        failure_reason: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('payment_tx_hash', paymentTxHash).eq('status', 'processing');
      throw e;
    }
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

    // Atomic state claim: the last two joins can both observe a full room, but only one caller is
    // allowed to move waiting -> purchasing and submit the real CollectorCrypt purchase.
    const { data: claimed, error: claimError } = await db
      .from('gacha_rooms')
      .update({ status: 'purchasing', updated_at: new Date().toISOString() })
      .eq('id', roomId)
      .eq('status', 'waiting')
      .select('id');
    if (claimError) throw new Error(`Room ${roomId}: failed to claim purchase transition: ${claimError.message}`);
    if (!claimed?.length) return;
    await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.PURCHASING);
    this.logger.log(`Room ${roomId}: all ${room.seats} seats filled and locked in — buying the pack`);
    this.events.emit(GACHA_EVENTS.ROOM_UPDATE, { roomId, seatsFilled: rows.length, seats: room.seats, status: 'purchasing' });

    // Fire-and-forget — the room-filling moment should feel instant rather than waiting for the
    // next cron tick.
    this.purchaseAndOpenRoom(roomId).catch(async (e) => {
      const reason = e instanceof Error ? e.message : String(e);
      // CollectorCryptApiError's own .message is a generic "Collectorcrypt request failed (400)"
      // fallback whenever their response body has no `.message` field — which discards the real
      // reason (rate limit? empty inventory? something else?) every single time this has actually
      // fired. Logging the raw body here is the difference between "it 400d again" and knowing why.
      if (e instanceof CollectorCryptApiError) {
        this.logger.error(`Room ${roomId}: Collectorcrypt error body: ${JSON.stringify(e.body)}`);
      }
      this.logger.error(`Room ${roomId}: purchase/open failed: ${reason}`);
      await db.from('gacha_rooms').update({
        status: 'failed',
        failure_reason: `Purchase/open failed: ${reason}`.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', roomId).in('status', ['purchasing', 'opening']);
      await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.FAILED);
    });
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
    const { data: room } = await db.from('gacha_rooms').select('id, status, seats, exclusion_count').eq('id', roomId).single();
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

    // vrf_requested_at/randomness/slot/fulfilled_at still hold the INITIAL EXCLUSION draw's own
    // (already-consumed, above) VRF request record — must be cleared here exactly like
    // resolveVoteCutDraw already does between later rounds, or castVote's `if (room.vrf_requested_at)
    // throw 'already locked in'` guard rejects EVERY round-1 vote unconditionally, before ever
    // touching on-chain state: confirmed live — a room's first vote round always failed this way,
    // independent of timing/deadlines/bot behavior, since this column was simply never reset.
    await db.from('gacha_rooms').update({
      status: 'voting', vote_round: 1,
      vrf_requested_at: null, vrf_randomness: null, vrf_request_slot: null, vrf_fulfilled_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);
    await this.syncOnchainInitialExclusion(roomId, room.seats, excludedSeatNumbers);
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
      await this.ensureOnchainVoteRoundStarted(roomId, round, survivors, yesP);
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

  /** Recovers the process-crash gap between Postgres entering a vote round and the delegated PDA
   *  actually starting it. The DB marker prevents a transient ER read failure from resetting a
   *  live round and erasing votes; the on-chain round check covers a crash after the transaction
   *  succeeded but before the marker update landed. */
  private async ensureOnchainVoteRoundStarted(
    roomId: string,
    round: number,
    survivors?: Array<{ id: string; user_id: string; seat_number: number }>,
    yesProbability?: number,
  ): Promise<void> {
    const currentSurvivors = survivors ?? await this.getSurvivors(roomId);
    const botYesProbability = yesProbability ?? Math.max(0.72 - (round - 1) * 0.28, 0.08);
    const db = this.supabase.getClient();
    const seats = await this.getRoomSeats(roomId);
    if (seats === null) throw new Error(`Room ${roomId}: cannot start on-chain vote without seat capacity`);
    // Active voting requires the PDA in the ER even if the round marker/state already exists
    // (for example after a process restart between an accidental undelegation and the next vote).
    await this.onchainState.ensureRoomDelegated(roomId, seats);
    const { data: room } = await db.from('gacha_rooms').select('onchain_vote_round').eq('id', roomId).single();
    const state = await this.onchainState.getVoteState(roomId);
    if (state?.round === round || room?.onchain_vote_round === round) return;

    await this.onchainState.startVoteRound(roomId, round, currentSurvivors.map((p) => p.seat_number));
    const { error } = await db.from('gacha_rooms').update({ onchain_vote_round: round }).eq('id', roomId);
    if (error) throw new Error(`Room ${roomId}: failed to record on-chain vote round ${round}: ${error.message}`);
    for (const participant of currentSurvivors) {
      if (participant.user_id.startsWith('bot-')) {
        await this.onchainState.castVote(roomId, participant.seat_number, Math.random() < botYesProbability);
      }
    }
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
        await this.withVoteLock(room.id, async () => {
          await this.ensureOnchainVoteRoundStarted(room.id, room.vote_round);
          await this.checkVoteRoundCompleteOnchain(room.id, room.vote_round);
        }).catch((e) => this.logger.error(`Room ${room.id}: vote completion check failed: ${e.message}`));
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
    await this.syncOnchainVoteCut(roomId, round, victim.seat_number);
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

  /** generatePack has 400d transiently 3 times this session — every time, the exact same request
   *  (identical packType/playerAddress, zero changes on our side) succeeded on manual retest
   *  seconds to minutes later, so this is CollectorCrypt-side flakiness, not a bad request. Safe
   *  to retry blindly here: generatePack only returns an unsigned transaction template, nothing
   *  has been signed or submitted yet at this point, so a retry can't double-purchase or
   *  double-charge anything. Previously every one of these transient blips permanently failed a
   *  fully-paid, fully-seated room and needed manual admin refund — see the plan/session notes. */
  private async generatePackWithRetry(packType: CollectorCryptPackType, playerAddress: string): Promise<GeneratePackResponse> {
    const retryDelaysMs = [2000, 5000, 10000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        return await this.collectorCrypt.generatePack(packType, playerAddress);
      } catch (e) {
        lastError = e;
        const reason = e instanceof Error ? e.message : String(e);
        const body = e instanceof CollectorCryptApiError ? ` body=${JSON.stringify(e.body)}` : '';
        if (attempt < retryDelaysMs.length) {
          this.logger.warn(`generatePack attempt ${attempt + 1}/${retryDelaysMs.length + 1} failed, retrying in ${retryDelaysMs[attempt]}ms: ${reason}${body}`);
          await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
        } else {
          this.logger.error(`generatePack failed after ${retryDelaysMs.length + 1} attempts: ${reason}${body}`);
        }
      }
    }
    throw lastError;
  }

  private async purchaseAndOpenRoom(roomId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: room, error } = await db.from('gacha_rooms').select('id, pack_type, seats').eq('id', roomId).single();
    if (error || !room) throw new Error(`Room ${roomId} not found for purchase`);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();

    const generated = await this.generatePackWithRetry(room.pack_type as CollectorCryptPackType, treasuryKeypair.publicKey.toBase58());
    const purchaseTxSig = await this.signAndSubmit(generated.transaction, treasuryKeypair, conn);
    await db.from('gacha_rooms').update({
      collectorcrypt_memo: generated.memo,
      purchase_tx_sig: purchaseTxSig,
      status: 'opening',
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);
    await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.OPENING);

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
      await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.FAILED);
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
    await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.EXCLUDING);

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
    let versioned: VersionedTransaction | null = null;
    try {
      versioned = VersionedTransaction.deserialize(bytes);
    } catch {
      // CollectorCrypt may return a legacy transaction; parse it below. Do not wrap submission
      // in this catch, otherwise a real API/RPC error gets misreported as a legacy parse error.
    }
    if (versioned) {
      versioned.sign([signer]);
      const submitted = await this.collectorCrypt.submitTransaction(Buffer.from(versioned.serialize()).toString('base64'));
      return submitted.signature;
    }
    const tx = Transaction.from(bytes);
    tx.partialSign(signer);
    const submitted = await this.collectorCrypt.submitTransaction(tx.serialize({ requireAllSignatures: false }).toString('base64'));
    return submitted.signature;
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

    // 40 * 1.5s = 60s — same reasoning as devForceAdvanceVoting's identical widening below: real
    // oracle fulfillment latency observed this session could run close to a minute, well past the
    // old 15s window, which made this look like a no-op rather than a still-pending request.
    let status = room.status;
    for (let i = 0; i < 40 && status === 'excluding'; i++) {
      await this.advanceExclusionDraw(roomId);
      const { data: after } = await db.from('gacha_rooms').select('status').eq('id', roomId).single();
      status = after?.status ?? status;
      if (status === 'excluding') await new Promise((r) => setTimeout(r, 1500));
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
      if (this.onchainVoteStateEnabled) {
        // The ER program reads the chain clock and deliberately cannot be forced past its 30s
        // deadline. This still recovers/advances any genuinely complete on-chain round.
        await this.ensureOnchainVoteRoundStarted(roomId, room.vote_round);
        await this.checkVoteRoundCompleteOnchain(roomId, room.vote_round);
      } else {
        this.voteRoundStartedAt.set(roomId, 0); // force the 30s window to already be elapsed
        await this.maybeTimeoutVoteRound(roomId, room.vote_round);
      }
    }

    // 40 * 1.5s = 60s, not the old 15 * 1s = 15s — real oracle fulfillment observed this session
    // ran anywhere from ~10s to nearly 60s, so the old window frequently expired while a request
    // was still genuinely in flight, silently returning with status still 'voting' and looking
    // like the button just did nothing (it hadn't failed, it just stopped checking too early).
    let status = room.status;
    for (let i = 0; i < 40 && status === 'voting'; i++) {
      const { data: current } = await db.from('gacha_rooms').select('status, vote_round, vrf_requested_at').eq('id', roomId).single();
      if (current?.vrf_requested_at) await this.resolveVoteCutDraw(roomId, current.vote_round);
      const { data: after } = await db.from('gacha_rooms').select('status').eq('id', roomId).single();
      status = after?.status ?? status;
      if (status === 'voting') await new Promise((r) => setTimeout(r, 1500));
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
    const { data: room } = await db.from('gacha_rooms').select('id, status, pending_bid_id, pending_bid_deadline, entry_usdc').eq('id', roomId).maybeSingle();
    if (!room || room.status !== 'settling' || !room.pending_bid_id) throw new BadRequestException('No bid is currently awaiting payment on this room');
    if (!room.pending_bid_deadline || new Date(room.pending_bid_deadline).getTime() <= Date.now()) throw new BadRequestException('Payment window has expired');

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
    await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.SETTLING);

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
      await this.syncOnchainPhase(roomId, room.seats, GACHA_ROOM_PHASE.FAILED);
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
    const sig = await conn.sendRawTransaction(tx.serialize());
    await this.pollConfirmed(conn, sig);
    return sig;
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
      let status: Awaited<ReturnType<Connection['getSignatureStatus']>>;
      try {
        status = await conn.getSignatureStatus(sig);
      } catch (e) {
        throw new SubmittedTransactionUnconfirmedError(sig, `Transaction ${sig} was submitted but its status could not be read: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') return;
      if (status.value?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(status.value.err)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new SubmittedTransactionUnconfirmedError(sig, `Transaction ${sig} was submitted but not confirmed after ${attempts} attempts`);
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
    const unitsByParticipant = calculateGachaPayoutUnits(rows, totalUnits);
    const survivorCount = rows.filter((p: any) => !p.excluded).length;

    for (const p of rows) {
      const units = unitsByParticipant.get(p.id) ?? 0n;
      const { error } = await db.from('gacha_room_participants').update({ payout_usdc: Number(units) / 1_000_000 }).eq('id', p.id);
      if (error) throw new Error(`Room ${roomId}: failed to record payout for seat ${p.seat_number}: ${error.message}`);
    }

    const { error: settleError } = await db.from('gacha_rooms').update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pending_bid_id: null,
      pending_bid_deadline: null,
      ...(extra.buybackTxSig ? { buyback_tx_sig: extra.buybackTxSig } : {}),
      ...(extra.winningBidId ? { winning_bid_id: extra.winningBidId } : {}),
      ...(extra.nftTransferTxSig ? { nft_transfer_tx_sig: extra.nftTransferTxSig } : {}),
    }).eq('id', roomId);
    if (settleError) throw new Error(`Room ${roomId}: failed to mark settlement complete: ${settleError.message}`);
    await this.syncOnchainPhase(roomId, rows.length, GACHA_ROOM_PHASE.SETTLED);

    this.logger.log(`Room ${roomId}: settled, ${survivorCount} survivor payouts (${rows.length - survivorCount} excluded)`);
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

    const { data: participant } = await db.from('gacha_room_participants').select('id, payout_usdc, payout_tx_sig, payout_claim_token').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    if (!participant) throw new BadRequestException('You are not a participant in this room');
    if (participant.payout_tx_sig) throw new BadRequestException('Payout already claimed');
    if (participant.payout_claim_token) throw new BadRequestException('Payout claim is already being processed');
    if (participant.payout_usdc === null) throw new BadRequestException('Payout has not been computed yet');
    if (Number(participant.payout_usdc) <= 0) throw new BadRequestException('There is no payout to claim for this seat');

    // Acquire a durable per-participant claim lock before any transfer is submitted. This closes
    // the auto-claim/manual-retry race where two requests could both observe payout_tx_sig=NULL
    // and send the treasury transfer twice.
    const claimToken = randomUUID();
    const { data: claimed, error: claimError } = await db
      .from('gacha_room_participants')
      .update({ payout_claim_token: claimToken, payout_claim_started_at: new Date().toISOString() })
      .eq('id', participant.id)
      .is('payout_tx_sig', null)
      .is('payout_claim_token', null)
      .select('id');
    if (claimError) throw new Error(`Failed to lock payout claim: ${claimError.message}`);
    if (!claimed?.length) throw new BadRequestException('Payout claim is already being processed');

    const destination = await this.usersService.getSolanaWalletAddress(userId);
    try {
      const txSig = isPrivate
        ? await this.sendPrivatePayout(destination, Number(participant.payout_usdc))
        : await this.sendPublicPayout(destination, Number(participant.payout_usdc));

      const { error: recordError } = await db.from('gacha_room_participants').update({
        payout_tx_sig: txSig,
        payout_is_private: isPrivate,
        payout_claim_token: null,
        payout_claim_started_at: null,
      }).eq('id', participant.id).eq('payout_claim_token', claimToken);
      // Do not clear the claim lock if recording fails after funds moved: that would make a
      // blind client retry send twice. Ops can reconcile the logged signature safely.
      if (recordError) this.logger.error(`Payout ${txSig} sent for participant ${participant.id} but could not be recorded: ${recordError.message}`);
      return { txSig };
    } catch (e) {
      if (e instanceof SubmittedTransactionUnconfirmedError) {
        // The transfer may still land. Keep the durable lock so an automatic retry cannot send
        // twice; ops can reconcile the known signature from the error/log.
        this.logger.error(`Payout claim for participant ${participant.id} is awaiting manual confirmation of ${e.signature}`);
      } else {
        await db.from('gacha_room_participants').update({ payout_claim_token: null, payout_claim_started_at: null }).eq('id', participant.id).eq('payout_claim_token', claimToken);
      }
      throw e;
    }
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
    const sig = await conn.sendRawTransaction(tx.serialize());
    await this.pollConfirmed(conn, sig);
    return sig;
  }

  private async sendPrivatePayout(toAddress: string, amountUsdc: number): Promise<string> {
    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const cluster = 'devnet'; // Gacha Pooled Packs is devnet-only — see getSolanaConnection
    const relayFeeUnits = Math.round((await resolveMagicblockRelayFeeUsdc()) * 1_000_000);
    const transferUnits = Math.round(amountUsdc * 1_000_000) - relayFeeUnits; // exact-in: fee comes out of the payout, same as claims.service.ts's "claim privately" branch
    if (transferUnits <= 0) throw new BadRequestException('Payout is too small to cover the private-transfer relay fee — claim publicly instead');

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
