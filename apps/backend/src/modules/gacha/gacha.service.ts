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
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { requestMagicblockPrivateTransfer, resolveMagicblockRelayFeeUsdc } from '@/common/magicblock-private-transfer';
import { CollectorCryptClient, CollectorCryptPackType, NftMetadata, PackRarityTier } from './collectorcrypt.client';
import { GACHA_EVENTS } from './gacha.events';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Prefix a room/bid id so verifyOnChainMemo can tell a Gacha entry/bid payment apart from any
// other memo'd transfer ever sent to the shared treasury address.
const ROOM_MEMO_PREFIX = 'gacha-room:';
const BID_MEMO_PREFIX = 'gacha-bid:';

const BID_WINDOW_MS = 2 * 60_000;
const BID_PAYMENT_GRACE_MS = 5 * 60_000;

const OPEN_POLL_INTERVAL_MS = 3_000;
const OPEN_POLL_MAX_ATTEMPTS = 20; // ~1 minute total — openPack's "waiting_for_webhook" state

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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly collectorCrypt: CollectorCryptClient,
    private readonly events: EventEmitter2,
  ) {}

  // ── Solana plumbing (same pattern as PackService — see pack.service.ts) ──────────────

  private async getSolanaConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
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

  private async countParticipantsByRoom(roomIds: string[]): Promise<Record<string, number>> {
    if (!roomIds.length) return {};
    const db = this.supabase.getClient();
    const { data, error } = await db.from('gacha_room_participants').select('room_id').in('room_id', roomIds);
    if (error) throw new Error(`Failed to count gacha room participants: ${error.message}`);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) counts[row.room_id] = (counts[row.room_id] ?? 0) + 1;
    return counts;
  }

  /** Full detail for one room regardless of status (listOpenRooms only ever returns
   *  active-lifecycle rooms) plus the caller's own participation/payout/bid state, so a single
   *  room screen can poll one endpoint through the whole lobby -> bidding -> settled flow. */
  async getRoomDetail(roomId: string, userId: string): Promise<{
    room: RoomSummary;
    myParticipant: { seatNumber: number; payoutUsdc: number | null; payoutIsPrivate: boolean | null; claimed: boolean } | null;
    bestBid: { amountUsdc: number } | null;
    pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
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
  async buildJoinTx(configKey: string, userSolanaAddress: string, userId: string): Promise<{ txBase64: string; roomId: string; entryUsdc: number }> {
    const cfg = await this.getConfig(configKey);
    const room = await this.findOrCreateWaitingRoom(cfg);

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromPubkey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${ROOM_MEMO_PREFIX}${room.id}`, 'utf8') }),
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, USDC_MINT),
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

  /** Debits the account that lost the most USDC in `tx` and returns its owner — same technique
   *  PackService.findUsdcDebitOwner uses to identify a payment's real sender. */
  private findUsdcDebitOwner(tx: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>): { owner: string | null; amount: bigint } {
    const usdcMint = USDC_MINT.toBase58();
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
    const usdcMint = USDC_MINT.toBase58();

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

    const { count } = await db.from('gacha_room_participants').select('id', { count: 'exact', head: true }).eq('room_id', roomId);
    const seatNumber = (count ?? 0) + 1;

    const { error: insertError } = await db.from('gacha_room_participants').insert({
      room_id: roomId,
      user_id: userId,
      seat_number: seatNumber,
      payment_tx_hash: paymentTxHash,
    });
    if (insertError) {
      if ((insertError as any).code === '23505') throw new BadRequestException('This payment has already been used to join a room');
      // Trigger-raised exception (room full) also lands here — Postgres reports it as a generic error, not 23505.
      throw new BadRequestException('This room just filled up — try another room');
    }

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

    const generated = await this.collectorCrypt.generatePack(room.pack_type as CollectorCryptPackType);
    const purchaseTxSig = await this.signAndSubmit(generated.transaction, treasuryKeypair, conn);
    await db.from('gacha_rooms').update({
      collectorcrypt_memo: generated.memo,
      purchase_tx_sig: purchaseTxSig,
      status: 'opening',
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    let opened = null;
    for (let attempt = 0; attempt < OPEN_POLL_MAX_ATTEMPTS; attempt++) {
      const result = await this.collectorCrypt.openPack(generated.memo);
      if (result.status === 'success' || result.status === 'already_opened') { opened = result; break; }
      await new Promise((r) => setTimeout(r, OPEN_POLL_INTERVAL_MS));
    }
    if (!opened?.nft) {
      await db.from('gacha_rooms').update({ status: 'failed', failure_reason: 'openPack never confirmed', updated_at: new Date().toISOString() }).eq('id', roomId);
      throw new Error(`Room ${roomId}: openPack never confirmed (timed out polling)`);
    }

    const treasuryAddress = treasuryKeypair.publicKey.toBase58();
    let buybackAmountUsdc: number | null = null;
    if (opened.nft.mint) {
      try {
        const avail = await this.collectorCrypt.buybackAvailable(opened.nft.mint, treasuryAddress);
        if (avail.available) buybackAmountUsdc = Number(avail.amountUnits) / 1_000_000;
      } catch (e: any) {
        this.logger.warn(`Room ${roomId}: buybackAvailable check failed (non-fatal, starting bid at $0): ${e.message}`);
      }
    }

    const bidWindowEndsAt = new Date(Date.now() + BID_WINDOW_MS).toISOString();
    await db.from('gacha_rooms').update({
      nft_metadata: opened.nft,
      rarity: opened.rarity ?? null,
      open_tx_sig: opened.signature ?? null,
      buyback_amount_usdc: buybackAmountUsdc,
      status: 'bidding',
      bid_window_ends_at: bidWindowEndsAt,
      opened_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);

    this.logger.log(`Room ${roomId}: opened rarity=${opened.rarity} buyback=$${buybackAmountUsdc} — bidding window open`);
    this.events.emit(GACHA_EVENTS.ROOM_OPENED, { roomId, nftMetadata: opened.nft, rarity: opened.rarity ?? null, buybackAmountUsdc, bidWindowEndsAt });
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
    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromPubkey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${BID_MEMO_PREFIX}${bid.id}`, 'utf8') }),
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, USDC_MINT),
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
    const buybackTxSig = await this.signAndSubmit(built.transaction, treasuryKeypair, conn);
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
    const ata = await getAssociatedTokenAddress(USDC_MINT, treasury);
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
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, treasuryKeypair.publicKey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, toPubkey);

    const tx = new Transaction();
    if (!(await tokenAccountExists(conn, toAta))) {
      const allowed = await guardAtaSponsorship(this.supabase, toAddress, USDC_MINT.toBase58(), `gacha-payout:${toAddress}`);
      if (!allowed) throw new BadRequestException('This wallet already received a sponsored token account once before and closed it — free account creation is blocked to prevent abuse');
      tx.add(createAssociatedTokenAccountInstruction(treasuryKeypair.publicKey, toAta, toPubkey, USDC_MINT));
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
    const cluster = isSolanaDevnetFromConfig(this.config) ? 'devnet' : 'mainnet';
    const relayFeeUnits = Math.round((await resolveMagicblockRelayFeeUsdc()) * 1_000_000);
    const transferUnits = Math.round(amountUsdc * 1_000_000) - relayFeeUnits; // exact-in: fee comes out of the payout, same as claims.service.ts's "claim privately" branch

    const txResponse = await requestMagicblockPrivateTransfer({
      from: treasuryKeypair.publicKey.toBase58(),
      to: toAddress,
      mint: USDC_MINT.toBase58(),
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
