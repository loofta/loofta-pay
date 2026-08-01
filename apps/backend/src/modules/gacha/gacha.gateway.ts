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
import { GACHA_EVENTS, GachaRoomUpdatePayload, GachaRoomOpenedPayload, GachaBidPlacedPayload, GachaRoomSettledPayload } from './gacha.events';

// Mirrors main.ts's own CORS logic (see bootstrap()) — read directly from process.env since
// @WebSocketGateway's cors option is evaluated at class-decoration time, before Nest's DI
// container (and therefore ConfigService) exists yet.
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins = (process.env.CORS_ORIGIN ?? (isProduction ? '' : 'http://localhost:3000'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * First WebSocket gateway in this backend — live room lobby + bidding updates. Namespace
 * `/gacha`; clients join a Socket.IO room keyed by the Gacha room's own id via `join_room`, and
 * receive `room:update` / `room:opened` / `bid:placed` / `room:settled` events scoped to it.
 * Every event payload here is intentionally non-sensitive (seat counts, NFT metadata, bid
 * amounts) — a participant's own payout amount is fetched over authenticated REST
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
 * cycle entirely: this file still imports GachaService (one-directional, for getRoomDetail — see
 * onJoinRoom), but GachaService no longer imports this file at all.
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
  }

  @SubscribeMessage('leave_room')
  async onLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    if (!body?.roomId) return;
    await client.leave(body.roomId);
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
    this.server?.to(roomId).emit('room:settled', rest);
  }
}
