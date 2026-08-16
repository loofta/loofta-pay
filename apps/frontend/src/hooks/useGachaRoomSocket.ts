"use client";

// Live updates for one Gacha room — connects directly to the backend's /gacha Socket.IO
// namespace (GachaGateway), NOT through the /api/gacha proxy route (that's a plain HTTP forward,
// not a websocket the same way a plain fetch proxy can't). Auth is a Privy access token passed
// in the handshake, same token getAccessToken() already gives every REST call in this app.

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export interface GachaRoomUpdateEvent {
  seatsFilled: number;
  seats: number;
  status: string;
}
export interface GachaRoomOpenedEvent {
  nftMetadata: Record<string, unknown> | null;
  rarity: string | null;
  buybackAmountUsdc: number | null;
  bidWindowEndsAt: string | null;
}
export interface GachaBidPlacedEvent {
  amountUsdc: number;
}
export interface GachaRoomSettledEvent {
  won: boolean;
}
export interface GachaReadyUpdateEvent {
  readyCount: number;
  seatNumber?: number;
}
export interface GachaEmojiUpdateEvent {
  seatNumber: number;
  emoji: string;
}
export interface GachaMascotLockedEvent {
  seatNumber: number;
  mascotKey: string;
}
export interface GachaRoomExcludedEvent {
  excludedSeatNumbers: number[];
}
export interface GachaVoteRoundStartedEvent {
  round: number;
  survivorSeatNumbers: number[];
}
export interface GachaVoteResultEvent {
  round: number;
  yesCount: number;
  totalCount: number;
  passed: boolean;
}
export interface GachaVoteCutEvent {
  round: number;
  seatNumber: number;
}

/**
 * Joins `roomId`'s Socket.IO room and surfaces the latest event of each type — the caller is
 * expected to also do an authoritative GET /api/gacha/rooms/:id fetch on mount (see the room
 * page), since a socket event only ever carries a delta, never a full snapshot except the
 * one-time `room:state` sent right after `join_room` (also surfaced here, as `snapshot`).
 *
 * `markReady`/`lastReadyUpdate`/`allReadyTick` back the no-click pack-opening flow: every
 * participant marks themselves ready, and once the backend sees everyone has, `room:all_ready`
 * fires (surfaced here as an incrementing counter, not a boolean, so an effect keyed on it fires
 * reliably even though in practice it only ever happens once per room).
 */
export function useGachaRoomSocket(roomId: string | null, accessToken: string | null | undefined, inviteCode?: string | null) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [lastUpdate, setLastUpdate] = useState<GachaRoomUpdateEvent | null>(null);
  const [lastOpened, setLastOpened] = useState<GachaRoomOpenedEvent | null>(null);
  const [lastBid, setLastBid] = useState<GachaBidPlacedEvent | null>(null);
  const [lastSettled, setLastSettled] = useState<GachaRoomSettledEvent | null>(null);
  const [lastReadyUpdate, setLastReadyUpdate] = useState<GachaReadyUpdateEvent | null>(null);
  const [allReadyTick, setAllReadyTick] = useState(0);
  const [emojiBySeat, setEmojiBySeat] = useState<Record<number, string>>({});
  const [readySeats, setReadySeats] = useState<number[]>([]);
  const [lastMascotLocked, setLastMascotLocked] = useState<GachaMascotLockedEvent | null>(null);
  const [lastExcluded, setLastExcluded] = useState<GachaRoomExcludedEvent | null>(null);
  const [lastVoteRoundStarted, setLastVoteRoundStarted] = useState<GachaVoteRoundStartedEvent | null>(null);
  const [lastVoteResult, setLastVoteResult] = useState<GachaVoteResultEvent | null>(null);
  const [lastVoteCut, setLastVoteCut] = useState<GachaVoteCutEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    if (!roomId || !accessToken) return;

    const socket = io(`${BACKEND_URL}/gacha`, { auth: { token: accessToken, ...(inviteCode ? { inviteCode } : {}) }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", { roomId, ...(inviteCode ? { inviteCode } : {}) });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:state", (data) => setSnapshot(data));
    socket.on("room:update", (data: GachaRoomUpdateEvent) => setLastUpdate(data));
    socket.on("room:opened", (data: GachaRoomOpenedEvent) => setLastOpened(data));
    socket.on("bid:placed", (data: GachaBidPlacedEvent) => setLastBid(data));
    socket.on("room:settled", (data: GachaRoomSettledEvent) => setLastSettled(data));
    socket.on("room:ready_update", (data: GachaReadyUpdateEvent) => {
      setLastReadyUpdate(data);
      if (data.seatNumber !== undefined) {
        setReadySeats((prev) => (prev.includes(data.seatNumber!) ? prev : [...prev, data.seatNumber!]));
      }
    });
    socket.on("room:ready_snapshot", (data: { readySeats: number[] }) => setReadySeats(data.readySeats ?? []));
    socket.on("room:all_ready", () => setAllReadyTick((n) => n + 1));
    socket.on("room:emoji_snapshot", (data: Record<number, string>) => setEmojiBySeat((prev) => ({ ...prev, ...data })));
    socket.on("room:emoji_update", (data: GachaEmojiUpdateEvent) => setEmojiBySeat((prev) => ({ ...prev, [data.seatNumber]: data.emoji })));
    socket.on("room:mascot_locked", (data: GachaMascotLockedEvent) => setLastMascotLocked(data));
    socket.on("room:excluded", (data: GachaRoomExcludedEvent) => setLastExcluded(data));
    socket.on("room:vote_round_started", (data: GachaVoteRoundStartedEvent) => { setLastVoteRoundStarted(data); setLastVoteResult(null); });
    socket.on("room:vote_result", (data: GachaVoteResultEvent) => setLastVoteResult(data));
    socket.on("room:vote_cut", (data: GachaVoteCutEvent) => setLastVoteCut(data));

    return () => {
      socket.emit("leave_room", { roomId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, accessToken, inviteCode]);

  const markReady = useCallback(() => {
    if (!roomIdRef.current) return;
    socketRef.current?.emit("mark_ready", { roomId: roomIdRef.current });
  }, []);

  const pickEmoji = useCallback((emoji: string) => {
    if (!roomIdRef.current) return;
    socketRef.current?.emit("pick_emoji", { roomId: roomIdRef.current, emoji });
  }, []);

  // Locking in a mascot is irreversible, so unlike pickEmoji/markReady (fire-and-forget) this
  // waits on the gateway's ack (see GachaGateway.onLockMascot) so the caller can show a real error
  // ("already locked in", room no longer waiting) instead of assuming success.
  const lockMascot = useCallback((mascotKey: string): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!roomIdRef.current || !socketRef.current) { resolve({ ok: false, error: "Not connected" }); return; }
      const timeout = setTimeout(() => resolve({ ok: false, error: "Timed out — please try again" }), 8000);
      socketRef.current.emit("lock_mascot", { roomId: roomIdRef.current, mascotKey }, (ack: { ok: boolean; error?: string }) => {
        clearTimeout(timeout);
        resolve(ack ?? { ok: false, error: "No response from server" });
      });
    });
  }, []);

  // Same one-shot/ack-based reasoning as lockMascot — a vote is a real, meaningful action, not
  // fire-and-forget presence.
  const castVote = useCallback((vote: boolean): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!roomIdRef.current || !socketRef.current) { resolve({ ok: false, error: "Not connected" }); return; }
      const timeout = setTimeout(() => resolve({ ok: false, error: "Timed out — please try again" }), 8000);
      socketRef.current.emit("cast_vote", { roomId: roomIdRef.current, vote }, (ack: { ok: boolean; error?: string }) => {
        clearTimeout(timeout);
        resolve(ack ?? { ok: false, error: "No response from server" });
      });
    });
  }, []);

  return {
    connected, snapshot, lastUpdate, lastOpened, lastBid, lastSettled, lastReadyUpdate, allReadyTick,
    emojiBySeat, readySeats, markReady, pickEmoji, lastMascotLocked, lastExcluded, lockMascot,
    lastVoteRoundStarted, lastVoteResult, lastVoteCut, castVote,
  };
}
