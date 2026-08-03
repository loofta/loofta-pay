// Event names + payload shapes shared between GachaService (emitter) and GachaGateway
// (listener/broadcaster). Deliberately its own file with no dependency on either of them — if
// GachaService imported GachaGateway directly (or vice versa) to share these types, that alone
// would recreate the exact circular-require crash this whole event-based design exists to avoid
// (see the comment on EventEmitterModule.forRoot() in app.module.ts).

export const GACHA_EVENTS = {
  ROOM_UPDATE: 'gacha.room.update',
  ROOM_OPENED: 'gacha.room.opened',
  BID_PLACED: 'gacha.bid.placed',
  ROOM_SETTLED: 'gacha.room.settled',
} as const;

export interface GachaRoomUpdatePayload {
  roomId: string;
  seatsFilled: number;
  seats: number;
  status: string;
}

export interface GachaRoomOpenedPayload {
  roomId: string;
  nftMetadata: unknown;
  rarity: string | null;
  buybackAmountUsdc: number | null;
  bidWindowEndsAt: string;
}

export interface GachaBidPlacedPayload {
  roomId: string;
  amountUsdc: number;
}

export interface GachaRoomSettledPayload {
  roomId: string;
  won: boolean;
}
