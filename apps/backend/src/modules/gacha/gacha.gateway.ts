import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { GachaService } from './gacha.service';
import {
  GACHA_EVENTS,
  GachaRoomUpdatePayload,
  GachaRoomOpenedPayload,
  GachaBidPlacedPayload,
  GachaRoomSettledPayload,
  GachaRoomExcludedPayload,
  GachaVoteRoundStartedPayload,
  GachaVoteResultPayload,
  GachaVoteCutPayload,
} from './gacha.events';

// Mirrors main.ts's own CORS logic (see bootstrap()) — read directly from process.env since
// @WebSocketGateway's cors option is evaluated at class-decoration time, before Nest's DI
// container (and therefore ConfigService) exists yet.
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins = (process.env.CORS_ORIGIN ?? (isProduction ? '' : 'http://localhost:3000'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Closed whitelist matching the frontend's AVATAR_EMOJIS (apps/frontend/src/components/
// PokerTable.tsx) — never trust an arbitrary client-supplied string into a broadcast every other
// socket in the room receives.
const ALLOWED_EMOJIS = new Set(['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🐵', '🐰', '🐹', '🦝', '🐻', '🐧', '🦄']);

/**
 * First WebSocket gateway in this backend — live room lobby + bidding updates, plus the
 * "everyone ready" gate that starts the pack-opening animation for every participant at once
 * (see onMarkReady below — there is no click-to-open in Gacha; the reveal starts automatically
 * once every current participant has marked themselves ready).
 *
 * Namespace `/gacha`; clients join a Socket.IO room keyed by the Gacha room's own id via
 * `join_room`, and receive `room:update` / `room:opened` / `bid:placed` / `room:settled` /
 * `room:ready_update` / `room:ready_snapshot` / `room:all_ready` events scoped to it. Every event
 * payload here is intentionally non-sensitive (seat counts, NFT metadata, bid amounts, which seat
 * numbers are ready) — a participant's own payout amount is fetched over authenticated REST
 * (GachaService.getRoomDetail), never broadcast to the room.
 *
 * GachaService never calls this class directly — it emits GACHA_EVENTS via EventEmitter2
 * (registered globally in app.module.ts) and this gateway listens (@OnEvent below) and
 * broadcasts. That indirection isn't optional decoration: GachaService <-> GachaGateway used to
 * inject each other directly via forwardRef, which crashed on boot with a
 * "Cannot access 'GachaService' before initialization" ReferenceError — a genuine circular
 * `require()` between the two files, since TS's emitDecoratorMetadata evaluates each
 * constructor's parameter types (a literal class reference) immediately at file-load time,
 * before either class has finished being defined. forwardRef alone doesn't fix that when BOTH
 * sides hold a real (non-lazy) top-level import of the other's class. The event bus removes the
 * cycle entirely: this file still imports GachaService (one-directional, for getRoomDetail/
 * getRoomSeats/getBotSeatNumbers/getMySeatNumber), but GachaService no longer imports this file
 * at all.
 *
 * Operational note: if this backend ever runs multiple instances, Socket.IO needs a shared
 * adapter (e.g. @socket.io/redis-adapter) so an event emitted from one instance reaches clients
 * connected to another — not needed for a single-instance deployment.
 */
@WebSocketGateway({ namespace: '/gacha', cors: { origin: corsOrigins.length ? corsOrigins : false, credentials: true } })
export class GachaGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(GachaGateway.name);

  @WebSocketServer()
  server: Server;

  // In-memory only, on purpose — "who's currently ready to watch the reveal" is presence, not a
  // durable business fact worth a migration/column. Bounded and self-cleaning: cleared once a
  // room fully settles (onRoomSettled below), and every room this ever grows an entry for is a
  // real, already-paid-for room (there's no way to spam entries here). Keyed by SEAT NUMBER, not
  // raw participant id (same posture as emojiByRoom below) — the PokerTable UI shows ready state
  // directly on each seat's avatar, so the seat number is what every broadcast/snapshot carries.
  private readonly readyByRoom = new Map<string, Set<number>>();
  // Same in-memory-only reasoning as readyByRoom — a chosen avatar emoji is cosmetic presence,
  // not a durable fact, and doesn't need a migration/column. Keyed by seat number (never by raw
  // Privy user id — see onPickEmoji) so a late joiner's `room:emoji_snapshot` never leaks other
  // participants' identities beyond what the REST participants list already exposes.
  private readonly emojiByRoom = new Map<string, Map<number, string>>();

  constructor(
    private readonly privy: PrivyVerificationService,
    private readonly gacha: GachaService,
  ) {}

  /**
   * Same Bearer-token verification AuthGuard does for REST — Socket.IO has no header convention
   * for this, so the client passes it as handshake auth: `io(url, { auth: { token } })`.
   *
   * This MUST be socket.io connection middleware (`server.use`), not the `handleConnection`
   * lifecycle hook NestJS docs lead with — that distinction is not cosmetic. `handleConnection`
   * fires from socket.io's own `"connection"` event, but @SubscribeMessage handlers are bound to
   * the RAW socket the moment it connects, independent of whether `handleConnection`'s async body
   * has finished. The frontend fires `join_room` the instant its own `"connect"` event sees the
   * transport open — so with auth done here as `handleConnection` instead, there is a real race
   * where `join_room` can be DISPATCHED AND PROCESSED before this async token verification
   * (an awaited network call to Privy) has finished setting `client.data.userId`, silently
   * short-circuiting `onJoinRoom`'s `!client.data?.userId` guard. The socket then sits connected
   * but never actually `.join()`s the room — confirmed live: `pick_emoji` succeeded server-side
   * (seat found, broadcast sent) but `client.rooms.has(roomId)` was false, so the sender's own
   * broadcast never reached them even though everyone else in the room would have gotten it.
   * Connection middleware runs during the handshake itself and blocks the connection from being
   * considered established — and therefore blocks every @SubscribeMessage handler — until `next()`
   * is called, which closes this race entirely rather than just narrowing it.
   */
  afterInit(server: Server): void {
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      const token = (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.query?.token as string | undefined);
      if (!token) { next(new Error('Unauthorized')); return; }
      const userId = await this.privy.verifyAccessToken(token).catch(() => null);
      if (!userId) { next(new Error('Unauthorized')); return; }
      socket.data.userId = userId;
      next();
    });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.data?.userId ?? client.id}`);
  }

  @SubscribeMessage('join_room')
  async onJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    if (!body?.roomId || !client.data?.userId) return;
    await client.join(body.roomId);
    // Send the caller an immediate snapshot so the UI doesn't sit blank until the next state
    // change from someone else triggers a broadcast.
    try {
      const detail = await this.gacha.getRoomDetail(body.roomId, client.data.userId);
      client.emit('room:state', detail);
    } catch (e: any) {
      this.logger.warn(`join_room ${body.roomId}: failed to send initial snapshot: ${e.message}`);
    }
    const emojiMap = this.emojiByRoom.get(body.roomId);
    if (emojiMap?.size) client.emit('room:emoji_snapshot', Object.fromEntries(emojiMap));

    // Bot seats are always-ready (see getBotSeatNumbers) and merged in alongside whatever real
    // participants have actually clicked ready, so a late joiner's avatars render correctly
    // without waiting for another ready_update broadcast.
    const readySet = this.readyByRoom.get(body.roomId);
    const botSeats = await this.gacha.getBotSeatNumbers(body.roomId).catch(() => [] as number[]);
    const mergedReady = new Set([...(readySet ?? []), ...botSeats]);
    if (mergedReady.size) client.emit('room:ready_snapshot', { readySeats: Array.from(mergedReady) });
  }

  @SubscribeMessage('leave_room')
  async onLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    if (!body?.roomId) return;
    await client.leave(body.roomId);
  }

  /**
   * No click-to-open in Gacha — every participant marks themselves ready, and once ALL of them
   * have (compared against the real paid-seat count, not just however many are currently
   * connected), the reveal animation starts automatically for everyone watching. Known gap: if a
   * participant paid for a seat but never opens/keeps open the room page, this never reaches
   * "all ready" and the room's animation trigger stalls — there's no timeout/fallback yet. The
   * underlying purchase/open/settlement already happened automatically server-side regardless
   * (see GachaService.purchaseAndOpenRoom/settleDueRooms), so no money or real state is stuck —
   * only the client-side "everyone watches the rip together" moment is.
   */
  @SubscribeMessage('mark_ready')
  async onMarkReady(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const roomId = body?.roomId;
    const userId = client.data?.userId;
    if (!roomId || !userId) return;
    await this.markReady(roomId, userId);
  }

  /** Only ever called for a REAL participant's own socket — bots never connect one, so they
   *  never reach here; their readiness is computed structurally instead (getBotSeatNumbers). */
  private async markReady(roomId: string, userId: string): Promise<void> {
    const seatNumber = await this.gacha.getMySeatNumber(roomId, userId).catch(() => null);
    if (seatNumber === null) return;

    let set = this.readyByRoom.get(roomId);
    if (!set) { set = new Set(); this.readyByRoom.set(roomId, set); }
    set.add(seatNumber);

    const botSeats = await this.gacha.getBotSeatNumbers(roomId).catch(() => [] as number[]);
    const readyCount = new Set([...set, ...botSeats]).size;
    this.server?.to(roomId).emit('room:ready_update', { readyCount, seatNumber });

    const seats = await this.gacha.getRoomSeats(roomId).catch(() => null);
    if (seats !== null) await this.maybeFireAllReady(roomId, seats);
  }

  /**
   * Re-checks the "everyone ready" threshold against the room's fixed capacity (see
   * GachaService.getRoomSeats) — called both right after a real click (markReady) AND on every
   * single join via onRoomUpdate below. The second call site matters: someone can mark themselves
   * ready while the room is still filling (dev bot-fill can take well over a minute to trickle in
   * all 10 seats one at a time), and if they never click ready again, nothing else would ever
   * re-evaluate whether the threshold has since been met by the room simply finishing filling.
   * Idempotent against firing twice — once readyByRoom's entry for a room is deleted, a second
   * call with an empty/missing set is a no-op.
   */
  private async maybeFireAllReady(roomId: string, seats: number): Promise<void> {
    const set = this.readyByRoom.get(roomId);
    if (!set || set.size === 0) return;
    const botSeats = await this.gacha.getBotSeatNumbers(roomId).catch(() => [] as number[]);
    const readyCount = new Set([...set, ...botSeats]).size;
    if (readyCount >= seats) {
      this.server?.to(roomId).emit('room:all_ready', {});
      this.readyByRoom.delete(roomId);
    }
  }

  /** Lets a participant pick which animal avatar represents them in the room's PokerTable arc —
   *  broadcast by SEAT NUMBER, never by their raw Privy user id (seat number is already public
   *  UI; a user id isn't, and every socket in the room receives this event). */
  @SubscribeMessage('pick_emoji')
  async onPickEmoji(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string; emoji: string }): Promise<void> {
    const roomId = body?.roomId;
    const userId = client.data?.userId;
    if (!roomId || !userId || !ALLOWED_EMOJIS.has(body?.emoji)) return;

    const seatNumber = await this.gacha.getMySeatNumber(roomId, userId).catch(() => null);
    if (seatNumber === null) return;

    let map = this.emojiByRoom.get(roomId);
    if (!map) { map = new Map(); this.emojiByRoom.set(roomId, map); }
    map.set(seatNumber, body.emoji);

    this.server?.to(roomId).emit('room:emoji_update', { seatNumber, emoji: body.emoji });
  }

  /**
   * Locking in a mascot is a meaningful, irreversible action (unlike pick_emoji, which just
   * commits on click) — so unlike every other handler in this gateway, this one returns a value,
   * which NestJS relays back as the ack callback if the client passed one to `socket.emit(...)`.
   * The mascot whitelist and "already locked" check both live in GachaService.lockMascot (the one
   * place mascot state is actually persisted); this handler just forwards and relays whatever it
   * throws, rather than re-validating the same whitelist a second time here.
   */
  @SubscribeMessage('lock_mascot')
  async onLockMascot(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; mascotKey: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const roomId = body?.roomId;
    const userId = client.data?.userId;
    if (!roomId || !userId || !body?.mascotKey) return { ok: false, error: 'Invalid request' };

    try {
      const { seatNumber } = await this.gacha.lockMascot(roomId, userId, body.mascotKey);
      this.server?.to(roomId).emit('room:mascot_locked', { seatNumber, mascotKey: body.mascotKey });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Failed to lock in your mascot' };
    }
  }

  /**
   * "CUT ONE MORE?" — a survivor's vote for the current round. Ack-based like lock_mascot (a real
   * one-shot action, not fire-and-forget presence like pick_emoji/mark_ready). Vote tallying and
   * the majority-with-ties-as-YES rule both live in GachaService.castVote/checkVoteRoundComplete
   * (not this gateway) — voting needs to be checked from the cron sweep too (round timeouts, a
   * fully-bot-filled room with no human to click), not just from a live socket event, so unlike
   * readyByRoom/emojiByRoom the tally itself is service-owned, not gateway-owned.
   */
  @SubscribeMessage('cast_vote')
  async onCastVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; vote: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    const roomId = body?.roomId;
    const userId = client.data?.userId;
    if (!roomId || !userId || typeof body?.vote !== 'boolean') return { ok: false, error: 'Invalid request' };

    try {
      await this.gacha.castVote(roomId, userId, body.vote);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Failed to cast your vote' };
    }
  }

  @OnEvent(GACHA_EVENTS.ROOM_UPDATE)
  async onRoomUpdate(payload: GachaRoomUpdatePayload): Promise<void> {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:update', rest);
    // See maybeFireAllReady's comment — a join completing the room is itself a trigger the
    // threshold might now be met, not just a fresh mark_ready click.
    await this.maybeFireAllReady(roomId, payload.seats).catch((e) =>
      this.logger.warn(`onRoomUpdate ${roomId}: maybeFireAllReady failed: ${e.message}`),
    );
  }

  @OnEvent(GACHA_EVENTS.ROOM_OPENED)
  onRoomOpened(payload: GachaRoomOpenedPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:opened', rest);
  }

  @OnEvent(GACHA_EVENTS.BID_PLACED)
  onBidPlaced(payload: GachaBidPlacedPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('bid:placed', rest);
  }

  @OnEvent(GACHA_EVENTS.ROOM_SETTLED)
  onRoomSettled(payload: GachaRoomSettledPayload): void {
    const { roomId, ...rest } = payload;
    this.readyByRoom.delete(roomId);
    this.emojiByRoom.delete(roomId);
    this.server?.to(roomId).emit('room:settled', rest);
  }

  /** Fired once GachaService.advanceExclusionDraw resolves the VRF draw (which now runs AFTER the
   *  pack rips, not before — see gacha.service.ts) — the frontend's cue to play the kick-reveal
   *  animation before the room moves on to voting. */
  @OnEvent(GACHA_EVENTS.ROOM_EXCLUDED)
  onRoomExcluded(payload: GachaRoomExcludedPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:excluded', rest);
  }

  @OnEvent(GACHA_EVENTS.ROOM_VOTE_ROUND_STARTED)
  onVoteRoundStarted(payload: GachaVoteRoundStartedPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:vote_round_started', rest);
  }

  @OnEvent(GACHA_EVENTS.ROOM_VOTE_RESULT)
  onVoteResult(payload: GachaVoteResultPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:vote_result', rest);
  }

  @OnEvent(GACHA_EVENTS.ROOM_VOTE_CUT)
  onVoteCut(payload: GachaVoteCutPayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:vote_cut', rest);
  }
}
