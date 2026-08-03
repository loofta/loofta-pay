import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { GachaService } from './gacha.service';
import { GACHA_EVENTS, GachaRoomUpdatePayload, GachaRoomOpenedPayload, GachaBidPlacedPayload, GachaRoomSettledPayload, GachaBotReadyPayload } from './gacha.events';

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
 * numbers are ready) — a
 * participant's own payout amount is fetched over authenticated REST
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
 * getParticipantCount), but GachaService no longer imports this file at all.
 *
 * Operational note: if this backend ever runs multiple instances, Socket.IO needs a shared
 * adapter (e.g. @socket.io/redis-adapter) so an event emitted from one instance reaches clients
 * connected to another — not needed for a single-instance deployment.
 */
@WebSocketGateway({ namespace: '/gacha', cors: { origin: corsOrigins.length ? corsOrigins : false, credentials: true } })
export class GachaGateway implements OnGatewayConnection, OnGatewayDisconnect {
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

  /** Same Bearer-token verification AuthGuard does for REST — Socket.IO has no header
   *  convention for this, so the client passes it as handshake auth: `io(url, { auth: { token } })`. */
  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth?.token as string | undefined) ?? (client.handshake.query?.token as string | undefined);
    if (!token) {
      client.disconnect(true);
      return;
    }
    const userId = await this.privy.verifyAccessToken(token).catch(() => null);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
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
    const readySet = this.readyByRoom.get(body.roomId);
    if (readySet?.size) client.emit('room:ready_snapshot', { readySeats: Array.from(readySet) });
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

  /**
   * Bots (see GachaService.addBotParticipant) never connect a websocket, so they can never call
   * mark_ready themselves — without this, a bot-filled room's ready count could never reach the
   * total participant count (bots are counted in the total but would never contribute to the
   * numerator), and a real participant marking themselves ready would wait forever for
   * room:all_ready. Simulates each bot being instantly ready the moment it joins.
   */
  @OnEvent(GACHA_EVENTS.BOT_READY)
  async onBotReady(payload: GachaBotReadyPayload): Promise<void> {
    await this.markReady(payload.roomId, payload.botUserId);
  }

  private async markReady(roomId: string, participantKey: string): Promise<void> {
    const seatNumber = await this.gacha.getMySeatNumber(roomId, participantKey).catch(() => null);
    if (seatNumber === null) return;

    let set = this.readyByRoom.get(roomId);
    if (!set) { set = new Set(); this.readyByRoom.set(roomId, set); }
    set.add(seatNumber);

    this.server?.to(roomId).emit('room:ready_update', { readyCount: set.size, seatNumber });

    const total = await this.gacha.getParticipantCount(roomId).catch(() => 0);
    if (total > 0 && set.size >= total) {
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

  @OnEvent(GACHA_EVENTS.ROOM_UPDATE)
  onRoomUpdate(payload: GachaRoomUpdatePayload): void {
    const { roomId, ...rest } = payload;
    this.server?.to(roomId).emit('room:update', rest);
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
}
