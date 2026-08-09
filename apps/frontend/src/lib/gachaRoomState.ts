import { PublicKey } from "@solana/web3.js";

export const GACHA_ROOM_STATE_PROGRAM_ID = new PublicKey(
  "45ShoiSQG8J4t1piSwsfYC38dyc9oLBbZmFr6W1KpowH",
);

const ROOM_PDA_SEED = new TextEncoder().encode("gacha-room");
const ACCOUNT_DISCRIMINATOR = new Uint8Array([
  150, 69, 248, 147, 181, 212, 177, 103,
]);
const LEGACY_ACCOUNT_SIZE = 101;
const EXTENDED_ACCOUNT_SIZE = 108;

export const GACHA_ROOM_PHASE = {
  WAITING: 0,
  PURCHASING: 1,
  OPENING: 2,
  EXCLUDING: 3,
  VOTING: 4,
  SETTLING: 5,
  SETTLED: 6,
  FAILED: 7,
  CANCELLED: 8,
} as const;

export interface GachaRoomStateAccount {
  seats: number;
  readyMask: number;
  voteRound: number;
  survivorMask: number;
  votedMask: number;
  yesMask: number;
  roundStartedAt: number;
  roundDeadline: number;
  finalized: boolean;
  phase: number;
  excludedMask: number;
  lastCutRound: number;
  lastCutSeat: number;
  settled: boolean;
}

export async function deriveGachaRoomStatePda(
  roomId: string,
): Promise<PublicKey> {
  const roomIdBytes = new TextEncoder().encode(roomId);
  const roomIdSeed = new Uint8Array(
    await crypto.subtle.digest("SHA-256", roomIdBytes.buffer as ArrayBuffer),
  );
  return PublicKey.findProgramAddressSync(
    [ROOM_PDA_SEED, roomIdSeed],
    GACHA_ROOM_STATE_PROGRAM_ID,
  )[0];
}

/**
 * Decodes the fixed Anchor account layout in programs/gacha-room-state/src/lib.rs.
 * Keeping this reader small avoids shipping a signer/provider just to render public tally bits.
 */
export function decodeGachaRoomState(data: Uint8Array): GachaRoomStateAccount {
  if (data.byteLength < LEGACY_ACCOUNT_SIZE) {
    throw new Error(`GachaRoomState is too short (${data.byteLength} bytes)`);
  }
  for (let i = 0; i < ACCOUNT_DISCRIMINATOR.length; i += 1) {
    if (data[i] !== ACCOUNT_DISCRIMINATOR[i]) {
      throw new Error("Account is not a GachaRoomState PDA");
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    // discriminator (8) + room_id_seed (32) + authority (32)
    seats: view.getUint8(72),
    readyMask: view.getUint16(73, true),
    voteRound: view.getUint16(75, true),
    survivorMask: view.getUint16(77, true),
    votedMask: view.getUint16(79, true),
    yesMask: view.getUint16(81, true),
    roundStartedAt: Number(view.getBigInt64(83, true)),
    roundDeadline: Number(view.getBigInt64(91, true)),
    finalized: view.getUint8(99) !== 0,
    phase: data.byteLength >= EXTENDED_ACCOUNT_SIZE ? view.getUint8(101) : GACHA_ROOM_PHASE.WAITING,
    excludedMask: data.byteLength >= EXTENDED_ACCOUNT_SIZE ? view.getUint16(102, true) : 0,
    lastCutRound: data.byteLength >= EXTENDED_ACCOUNT_SIZE ? view.getUint16(104, true) : 0,
    lastCutSeat: data.byteLength >= EXTENDED_ACCOUNT_SIZE ? view.getUint8(106) : 0,
    settled: data.byteLength >= EXTENDED_ACCOUNT_SIZE ? view.getUint8(107) !== 0 : false,
  };
}

export function maskToSeatNumbers(mask: number, seats: number): number[] {
  const result: number[] = [];
  for (let seat = 1; seat <= seats; seat += 1) {
    if ((mask & (1 << (seat - 1))) !== 0) result.push(seat);
  }
  return result;
}

export function countMask(mask: number): number {
  let value = mask;
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}
