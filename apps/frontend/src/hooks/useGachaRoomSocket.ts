"use client";

// Live updates for one Gacha room — connects directly to the backend's /gacha Socket.IO
// namespace (GachaGateway), NOT through the /api/gacha proxy route (that's a plain HTTP forward,
// or a websocket the same way a plain fetch proxy can't). Auth is a Privy access token passed in
// the handshake, same token getAccessToken() already gives every REST call in this app.

import { useEffect, useRef, useState } from "react";
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
  bidWindowEndsAt: string;
}
export interface GachaBidPlacedEvent {
  amountUsdc: number;
}
export interface GachaRoomSettledEvent {
  won: boolean;
}

/**
 * Joins `roomId`'s Socket.IO room and surfaces the latest event of each type — the caller is
 * expected to also do an authoritative GET /api/gacha/rooms/:id fetch on mount (see the room
 * page), since a socket event only ever carries a delta, never a full snapshot except the
 * one-time `room:state` sent right after `join_room` (also surfaced here, as `snapshot`).
 */
export function useGachaRoomSocket(roomId: string | null, accessToken: string | null | undefined) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [lastUpdate, setLastUpdate] = useState<GachaRoomUpdateEvent | null>(null);
  const [lastOpened, setLastOpened] = useState<GachaRoomOpenedEvent | null>(null);
  const [lastBid, setLastBid] = useState<GachaBidPlacedEvent | null>(null);
  const [lastSettled, setLastSettled] = useState<GachaRoomSettledEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomId || !accessToken) return;

    const socket = io(`${BACKEND_URL}/gacha`, { auth: { token: accessToken }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", { roomId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:state", (data) => setSnapshot(data));
    socket.on("room:update", (data: GachaRoomUpdateEvent) => setLastUpdate(data));
    socket.on("room:opened", (data: GachaRoomOpenedEvent) => setLastOpened(data));
    socket.on("bid:placed", (data: GachaBidPlacedEvent) => setLastBid(data));
    socket.on("room:settled", (data: GachaRoomSettledEvent) => setLastSettled(data));

    return () => {
      socket.emit("leave_room", { roomId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, accessToken]);

  return { connected, snapshot, lastUpdate, lastOpened, lastBid, lastSettled };
}
