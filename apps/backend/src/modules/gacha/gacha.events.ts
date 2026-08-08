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
  ROOM_EXCLUDED: 'gacha.room.excluded',
  ROOM_VOTE_ROUND_STARTED: 'gacha.room.vote_round_started',
  ROOM_VOTE_RESULT: 'gacha.room.vote_result',
  ROOM_VOTE_CUT: 'gacha.room.vote_cut',
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
  /** No more bid auction — always null now, kept on the payload only because the frontend socket
   *  event type still declares it (dormant field, harmless to leave). */
  bidWindowEndsAt: string | null;
}

export interface GachaBidPlacedPayload {
  roomId: string;
  amountUsdc: number;
}

export interface GachaRoomSettledPayload {
  roomId: string;
  won: boolean;
}

export interface GachaRoomExcludedPayload {
  roomId: string;
  excludedSeatNumbers: number[];
}

export interface GachaVoteRoundStartedPayload {
  roomId: string;
  round: number;
  survivorSeatNumbers: number[];
}

export interface GachaVoteResultPayload {
  roomId: string;
  round: number;
  yesCount: number;
  totalCount: number;
  passed: boolean;
}

export interface GachaVoteCutPayload {
  roomId: string;
  round: number;
  seatNumber: number;
}
