"use client";

// Gacha "Rip Party" — pick your mascot, then pick a room size (which is when the actual
// join-tx/payment happens). Fully chromeless (see AppShell's isGachaRoomPage) — the explainer +
// Start button live at /app/gacha instead, which keeps the normal app header. See
// apps/backend/src/modules/gacha for the room lifecycle this leads into (waiting -> purchasing ->
// opening (rip) -> excluding (roulette) -> voting (cut one more?) -> settled).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { AlertCircle, Check, ChevronLeft, Copy, Eye, Lock, LogOut, Plus, RefreshCw } from "lucide-react";
import MascotPicker from "@/components/MascotPicker";
import { Shell } from "@/components/PackParty";
import Mascot from "@/components/Mascot";
import { getMascot } from "@/lib/mascots";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RoomConfig {
  configKey: string;
  packType: string;
  seats: number;
  entryUsdc: number;
  enabled: boolean;
  displayOrder: number;
}

interface WaitingRoom {
  id: string;
  name: string;
  configKey: string;
  seats: number;
  entryUsdc: number;
  seatsFilled: number;
  isPrivate: boolean;
  inviteCode?: string | null;
  createdAt: string;
  participants: Array<{ seatNumber: number; mascotKey: string | null }>;
}

interface ActiveRoom {
  id: string;
  name: string;
  configKey: string;
  seats: number;
  seatsFilled: number;
  status: string;
  createdAt: string;
  participants: Array<{ seatNumber: number; mascotKey: string | null }>;
}

function liveStatusLabel(status: string): string {
  switch (status) {
    case "purchasing": return "buying the pack";
    case "opening": return "ripping live";
    case "excluding": return "exclusion draw";
    case "voting": return "players voting";
    case "bidding": return "bidding live";
    case "settling": return "settling payouts";
    default: return status;
  }
}

function roomHref(room: Pick<WaitingRoom, "id" | "inviteCode">): string {
  const inviteQuery = room.inviteCode
    ? `?inviteCode=${encodeURIComponent(room.inviteCode)}`
    : "";
  return `/app/gacha/${room.id}${inviteQuery}`;
}

function friendlyJoinError(rawMessage: string | undefined): string {
  const s = (rawMessage ?? "").toLowerCase();
  if (s.includes("insufficient funds")) return "Not enough USDC in your wallet for this room's entry.";
  if (s.includes("user rejected") || s.includes("denied")) return "Payment cancelled.";
  if (s.includes("filled up")) return "This room just filled up — try again to join another one.";
  return rawMessage && rawMessage.length < 200 ? rawMessage : "Couldn't join right now — please try again.";
}

type Stage = "pick" | "size";
type RoomMode = "browse" | "create";

export default function GachaPlayPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get("inviteCode");
  const directRoomId = searchParams.get("roomId");
  const rematchRoomId = searchParams.get("rematchRoomId");
  const rematchMascotKey = searchParams.get("mascotKey");
  const rematchClaimDeadline = searchParams.get("claimDeadline");
  const directRoomSeatsParam = searchParams.get("seats");
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find((w) => w.address === embeddedSolAddress) ?? wallets[0];

  // Run It Back carries the player's mascot in the URL. Start directly on the room/payment
  // stage so the rematch does not flash or require the mascot picker again.
  const [stage, setStage] = useState<Stage>(rematchRoomId && rematchMascotKey ? "size" : "pick");
  const [configs, setConfigs] = useState<RoomConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [mascotKey, setMascotKey] = useState<string | null>(rematchMascotKey);
  const [pickedSeats, setPickedSeats] = useState<number | null>(null);
  const [joiningSeats, setJoiningSeats] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<WaitingRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [activeRoomsLoading, setActiveRoomsLoading] = useState(false);
  const [activeRoomsError, setActiveRoomsError] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomMode, setRoomMode] = useState<RoomMode>("browse");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomNameEdited, setRoomNameEdited] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<WaitingRoom | null>(null);
  const [existingRoom, setExistingRoom] = useState<WaitingRoom | null>(null);
  const [invitedRoom, setInvitedRoom] = useState<WaitingRoom | null>(null);
  const [rematchRoom, setRematchRoom] = useState<WaitingRoom | null>(null);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const roomsRequestIdRef = useRef(0);
  const activeRoomsRequestIdRef = useRef(0);

  const loadConfigs = useCallback(async () => {
    setConfigsLoading(true);
    setConfigsError(null);
    try {
      const response = await fetch("/api/gacha/configs");
      if (!response.ok) throw new Error("Couldn't load room sizes");
      setConfigs(await response.json());
    } catch {
      setConfigsError("Couldn't load room sizes. Check your connection and try again.");
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  useEffect(() => { void loadConfigs(); }, [loadConfigs]);

  const enabledConfigs = configs.filter((c) => c.enabled);
  const seatSizes = Array.from(new Set(enabledConfigs.map((c) => c.seats))).sort((a, b) => a - b);
  useEffect(() => {
    const directRoomSeats = directRoomSeatsParam ? Number(directRoomSeatsParam) : null;
    if (directRoomSeats && seatSizes.includes(directRoomSeats)) {
      if (pickedSeats !== directRoomSeats) setPickedSeats(directRoomSeats);
      return;
    }
    if (pickedSeats === null && seatSizes.length) setPickedSeats(seatSizes[0]);
  }, [pickedSeats, seatSizes, directRoomSeatsParam]);
  const activeConfig = enabledConfigs.find((c) => c.seats === pickedSeats) ?? null;

  // A shared private link enters the same explicit flow as a public room, but the private room
  // is fetched by its bearer code and is never injected into the public waiting-room list.
  useEffect(() => {
    if (rematchRoomId) return;
    if (!inviteCode) {
      setInvitedRoom(null);
      setInviteLoading(false);
      return;
    }
    let cancelled = false;
    setInviteLoading(true);
    setRoomsError(null);
    fetch(`/api/gacha/rooms/invite/${encodeURIComponent(inviteCode)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "This invite is no longer valid");
        return response.json() as Promise<WaitingRoom>;
      })
      .then((room) => {
        if (cancelled) return;
        setInvitedRoom({ ...room, inviteCode });
        setPickedSeats(room.seats);
        setRoomMode("browse");
      })
      .catch((err: any) => {
        if (!cancelled) setRoomsError(err?.message?.length < 160 ? err.message : "This invite is no longer valid.");
      })
      .finally(() => { if (!cancelled) setInviteLoading(false); });
    return () => { cancelled = true; };
  }, [inviteCode, rematchRoomId]);

  // Run-it-back navigates here with the exact destination room. Fetch its detail instead of
  // relying on the public browser list: a rematch room may be temporarily absent while its
  // original players are rejoining, and private rematches are never listed publicly.
  useEffect(() => {
    if (!rematchRoomId || !authenticated) {
      if (!rematchRoomId) {
        setRematchRoom(null);
        setRematchLoading(false);
      }
      return;
    }
    let cancelled = false;
    setRematchLoading(true);
    setError(null);
    void (async () => {
      try {
        const token = await getAccessToken();
        const inviteQuery = inviteCode ? `?inviteCode=${encodeURIComponent(inviteCode)}` : "";
        const response = await fetch(`/api/gacha/rooms/${encodeURIComponent(rematchRoomId)}${inviteQuery}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "This rematch room is no longer available");
        const room = payload?.room;
        if (!room || room.status !== "waiting") throw new Error("This rematch room is no longer accepting joins");
        const nextRoom: WaitingRoom = {
          id: room.id,
          name: room.name ?? "Run it back",
          configKey: room.configKey,
          seats: room.seats,
          entryUsdc: Number(room.entryUsdc),
          seatsFilled: Number(room.seatsFilled ?? payload.participants?.length ?? 0),
          isPrivate: !!room.isPrivate,
          inviteCode: room.isPrivate ? (inviteCode ?? null) : null,
          createdAt: room.createdAt,
          participants: (payload.participants ?? []).map((participant: any) => ({
            seatNumber: participant.seatNumber,
            mascotKey: participant.mascotKey ?? null,
          })),
        };
        if (cancelled) return;
        setRematchRoom(nextRoom);
        setPickedSeats(nextRoom.seats);
        const carriedMascotKey = rematchMascotKey || payload.myParticipant?.mascotKey || null;
        setMascotKey(carriedMascotKey);
        setStage(carriedMascotKey ? "size" : "pick");
        setRoomMode("browse");
        setSelectedRoomId(nextRoom.id);
      } catch (err: any) {
        if (!cancelled) setError(err?.message?.length < 200 ? err.message : "This rematch room is no longer available.");
      } finally {
        if (!cancelled) setRematchLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rematchRoomId, rematchMascotKey, inviteCode, authenticated, getAccessToken]);

  const loadRooms = useCallback(async (showLoading = false) => {
    if (rematchRoomId) return;
    if (!activeConfig) return;
    const requestId = ++roomsRequestIdRef.current;
    if (showLoading) setRoomsLoading(true);
    setRoomsError(null);
    try {
      const response = await fetch(`/api/gacha/rooms/waiting?configKey=${encodeURIComponent(activeConfig.configKey)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn't load open rooms");
      const nextRooms: WaitingRoom[] = await response.json();
      if (requestId !== roomsRequestIdRef.current) return;
      setRooms(nextRooms);
      const directRoom = directRoomId ? nextRooms.find((room) => room.id === directRoomId) : null;
      setSelectedRoomId((current) => {
        if (directRoomId) return directRoom?.id ?? null;
        return nextRooms.some((room) => room.id === current) ? current : (nextRooms[0]?.id ?? null);
      });
      if (showLoading && directRoomId && !directRoom) {
        setError("This room is no longer open. Choose another room or create a new one.");
      }
    } catch {
      if (requestId !== roomsRequestIdRef.current) return;
      setRoomsError("Couldn't load open rooms. This is usually a network hiccup.");
    } finally {
      if (requestId === roomsRequestIdRef.current) setRoomsLoading(false);
    }
  }, [activeConfig, directRoomId, rematchRoomId]);

  const loadActiveRooms = useCallback(async (showLoading = false) => {
    if (rematchRoomId || !activeConfig) return;
    const requestId = ++activeRoomsRequestIdRef.current;
    if (showLoading) setActiveRoomsLoading(true);
    setActiveRoomsError(null);
    try {
      const response = await fetch(`/api/gacha/rooms/active?configKey=${encodeURIComponent(activeConfig.configKey)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn't load live rooms");
      const nextRooms: ActiveRoom[] = await response.json();
      if (requestId === activeRoomsRequestIdRef.current) setActiveRooms(nextRooms);
    } catch {
      if (requestId === activeRoomsRequestIdRef.current) {
        setActiveRoomsError("Couldn't load live rooms. Try again in a moment.");
      }
    } finally {
      if (requestId === activeRoomsRequestIdRef.current) setActiveRoomsLoading(false);
    }
  }, [activeConfig, rematchRoomId]);

  useEffect(() => {
    if (rematchRoomId) return;
    if (!activeConfig) return;
    roomsRequestIdRef.current += 1;
    void loadRooms(true);
    activeRoomsRequestIdRef.current += 1;
    void loadActiveRooms(true);
    const interval = window.setInterval(() => {
      void loadRooms(false);
      void loadActiveRooms(false);
    }, 5_000);
    return () => {
      window.clearInterval(interval);
      roomsRequestIdRef.current += 1;
      activeRoomsRequestIdRef.current += 1;
    };
  }, [activeConfig, loadRooms, loadActiveRooms, rematchRoomId]);

  // Changing size invalidates a picked/created room. loadRooms selects the first result, and the
  // backend returns rooms fullest-first so the room closest to starting becomes the default.
  useEffect(() => {
    if (rematchRoomId) return;
    setRoomMode("browse");
    setCreatedRoom(null);
    setExistingRoom(null);
    setSelectedRoomId(null);
    // The invite preview sets the size from the shared room after it has loaded. Keep that
    // preview through the resulting size update; a manual size toggle clears it explicitly.
    if (!inviteCode) setInvitedRoom(null);
  }, [pickedSeats, inviteCode, rematchRoomId]);

  // The room the user deliberately picked stays selected even when the backend reports a
  // different active seat. The active room is rendered as a separate blocker, never substituted
  // into the public/private selection as though it were the room they clicked.
  const selectedRoom = rematchRoom ?? createdRoom ?? invitedRoom ?? rooms.find((room) => room.id === selectedRoomId) ?? null;
  const shareableRoom = (rematchRoom?.isPrivate ? rematchRoom : null) ?? (createdRoom?.isPrivate ? createdRoom : null);
  // Filled seat previews show only confirmed participants. Creating a room does not take a seat
  // or charge the entry yet; the creator appears here only after the explicit paid join succeeds.
  const previewMascots: (string | null)[] = Array.from({ length: activeConfig?.seats ?? 0 }, (_, i) => {
    if (selectedRoom) return selectedRoom.participants.find((participant) => participant.seatNumber === i + 1)?.mascotKey ?? null;
    return null;
  });

  const startCreate = useCallback(() => {
    const fallbackName = `Room #${rooms.length + 1}`;
    if (directRoomId) router.replace("/app/gacha/play");
    setError(null);
    setRoomMode("create");
    setSelectedRoomId(null);
    setCreatedRoom(null);
    setExistingRoom(null);
    setInvitedRoom(null);
    setRoomName(fallbackName);
    setRoomNameEdited(false);
    setIsPrivate(false);
    if (!activeConfig) return;

    // This is only a display hint. If the user leaves the value untouched, the backend omits it
    // from the request and the database assigns the authoritative number inside its transaction.
    void fetch(`/api/gacha/rooms/next-number?configKey=${encodeURIComponent(activeConfig.configKey)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ roomNumber?: number }>;
      })
      .then((next) => {
        if (!next?.roomNumber) return;
        setRoomName((current) => current === fallbackName ? `Room #${next.roomNumber}` : current);
      })
      .catch(() => { /* fallbackName remains usable; the database still owns the final number */ });
  }, [rooms.length, activeConfig, directRoomId, router]);

  const handleCreateRoom = useCallback(async () => {
    if (!activeConfig || !roomName.trim()) return;
    if (!authenticated) { login(); return; }
    setCreatingRoom(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const explicitName = roomNameEdited ? roomName.trim() : undefined;
      const response = await fetch("/api/gacha/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ configKey: activeConfig.configKey, ...(explicitName ? { name: explicitName } : {}), isPrivate }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.code === "ALREADY_IN_WAITING_ROOM" && payload.room) {
          setExistingRoom(payload.room as WaitingRoom);
          setCreatedRoom(null);
          setInvitedRoom(null);
          setRoomMode("browse");
          setSelectedRoomId(payload.room.id);
          // This is a recoverable state, not an error: the user has already paid for a seat and
          // should be taken back to that room without another charge.
          setError(null);
          return;
        }
        throw new Error(payload?.message ?? "Failed to create room");
      }
      const room: WaitingRoom = payload as WaitingRoom;
      setExistingRoom(null);
      setCreatedRoom(room);
      setSelectedRoomId(room.id);
      if (!room.isPrivate) setRooms((current) => [...current.filter((item) => item.id !== room.id), room]);
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Couldn't create the room — please try again.");
    } finally {
      setCreatingRoom(false);
    }
  }, [activeConfig, roomName, roomNameEdited, isPrivate, authenticated, login, getAccessToken]);

  const copyInviteLink = useCallback(async (room: WaitingRoom | null = shareableRoom) => {
    if (!room?.inviteCode) return;
    const inviteUrl = `${window.location.origin}/app/gacha/invite/${encodeURIComponent(room.inviteCode)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const input = document.createElement("textarea");
      input.value = inviteUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 1800);
  }, [shareableRoom]);

  // MascotPicker normally locks a mascot to an already-joined room seat over the socket — here
  // there's no room yet, so this just captures the local pick and advances the flow.
  const handleLocalMascotPick = useCallback(async (key: string) => {
    setMascotKey(key);
    setStage("size");
    return { ok: true };
  }, []);

  const handleJoin = useCallback(
    async (targetRoom: WaitingRoom) => {
      if (!authenticated) { login(); return; }
      if (!embeddedWallet?.address) { setError("No Solana wallet found"); return; }
      if (!mascotKey) { setStage("pick"); return; }
      setJoiningSeats(targetRoom.seats);
      setError(null);
      try {
        const token = await getAccessToken();
        const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const inviteQuery = targetRoom.inviteCode ? `?inviteCode=${encodeURIComponent(targetRoom.inviteCode)}` : "";

        const joinTxRes = await fetch(`/api/gacha/rooms/${targetRoom.id}/join-tx${inviteQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
        });
        const joinTxPayload = await joinTxRes.json().catch(() => null);
        if (!joinTxRes.ok) {
          if (joinTxPayload?.code === "ALREADY_IN_DIFFERENT_WAITING_ROOM" && joinTxPayload.room) {
            setExistingRoom(joinTxPayload.room as WaitingRoom);
            setError(null);
            return;
          }
          throw new Error(joinTxPayload?.message ?? "Failed to prepare entry payment");
        }
        const { txBase64, roomId, alreadyJoined } = joinTxPayload;

        // Already have a seat in a waiting room for this config — nothing to sign, just go there.
        // A private-room invite code is bearer access until this user has a confirmed seat.
        // Preserve it even on the already-joined recovery path so the room detail request and
        // websocket handshake cannot lose their authorization context during navigation.
        if (alreadyJoined) { router.push(`/app/gacha/${roomId}${inviteQuery}`); return; }

        if (!txBase64) throw new Error("The room payment could not be prepared");
        const txBytes = Buffer.from(txBase64, "base64");
        const { signature: sigBytes } = await signAndSendTransaction({
          transaction: txBytes as unknown as Uint8Array,
          wallet: embeddedWallet as any,
          // Gacha Pooled Packs is devnet-only end to end (see gacha.service.ts) — this tx's
          // blockhash and every account it references only exist on devnet. Omitting `chain`
          // defaults to solana:mainnet (same default the rest of this app relies on elsewhere),
          // which fails simulation outright against a devnet transaction.
          chain: "solana:devnet",
        });
        const paymentTxHash = bs58.encode(sigBytes as Uint8Array);

        const joinRes = await fetch(`/api/gacha/rooms/${roomId}/join${inviteQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ paymentTxHash, mascotKey }),
        });
        if (!joinRes.ok) throw new Error((await joinRes.json().catch(() => null))?.message ?? "Failed to join room");

        router.push(`/app/gacha/${roomId}${inviteQuery}`);
      } catch (err: any) {
        setError(friendlyJoinError(err?.message));
        if ((err?.message ?? "").toLowerCase().includes("filled up")) {
          setCreatedRoom(null);
          setRoomMode("browse");
          void loadRooms(true);
        }
      } finally {
        setJoiningSeats(null);
      }
    },
    [authenticated, login, embeddedWallet, mascotKey, getAccessToken, signAndSendTransaction, router, loadRooms],
  );

  const handleLeaveRoom = useCallback(async () => {
    if (!existingRoom || leavingRoom) return;
    setLeavingRoom(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/gacha/rooms/${existingRoom.id}/leave`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Couldn't leave this room");
      setExistingRoom(null);
      setShowLeaveConfirm(false);
      await loadRooms(true);
    } catch (err: any) {
      setShowLeaveConfirm(false);
      setError(err?.message?.length < 200 ? err.message : "Couldn't leave this room — please try again.");
    } finally {
      setLeavingRoom(false);
    }
  }, [existingRoom, leavingRoom, getAccessToken, loadRooms]);

  const pickedMascot = getMascot(mascotKey);

  const ctaLabel = rematchRoom
    ? `RUN IT BACK FOR $${rematchRoom.entryUsdc.toFixed(2)} →`
    : createdRoom
    ? `JOIN ${createdRoom.name.toUpperCase()} FOR $${createdRoom.entryUsdc.toFixed(2)} →`
    : existingRoom
      ? "LEAVE CURRENT ROOM TO SWITCH"
    : roomMode === "create"
      ? "CREATE ROOM →"
      : selectedRoom
        ? activeConfig && `JOIN ${selectedRoom.name.toUpperCase()} FOR $${activeConfig.entryUsdc.toFixed(2)} →`
        : "SELECT A ROOM";
  const ctaDisabled =
    configsLoading || roomsLoading || rematchLoading || creatingRoom || joiningSeats !== null || leavingRoom || !!existingRoom
    || (roomMode === "create" && !createdRoom && !roomName.trim())
    || (roomMode === "browse" && !selectedRoom && !createdRoom);
  const handleCtaClick = () => {
    if (!activeConfig) return;
    if (rematchRoom) { void handleJoin(rematchRoom); return; }
    if (createdRoom) { void handleJoin(createdRoom); return; }
    if (roomMode === "create") { void handleCreateRoom(); return; }
    if (selectedRoom) void handleJoin(selectedRoom);
  };

  return (
    <div className="relative w-full min-h-screen">
      <Link
        href="/app/gacha"
        className="absolute left-4 top-4 z-20 flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </Link>

      {stage === "pick" && (
        <MascotPicker lockedMascotKey={null} onLock={handleLocalMascotPick} />
      )}

      {stage === "size" && (
        <Shell
          kicker="2 / 6 · LOBBY"
          title="THE"
          titleGrad="ROOM"
          sub={
            pickedMascot ? (
              <>
                playing as {pickedMascot.name} —{" "}
                <button
                  type="button"
                  onClick={() => setStage("pick")}
                  disabled={joiningSeats !== null}
                  className="underline underline-offset-2 hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  change
                </button>
              </>
            ) : undefined
          }
          footer={
            activeConfig && (
              <div className="pp-sharewrap">
                {shareableRoom?.isPrivate && shareableRoom.inviteCode && (
                  <button type="button" className="pp-copyinvite" onClick={() => { void copyInviteLink(); }}>
                    {copiedInvite ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                    {copiedInvite ? "Invite link copied" : "Copy invite link"}
                  </button>
                )}
                <button
                  type={roomMode === "create" && !createdRoom ? "submit" : "button"}
                  form={roomMode === "create" && !createdRoom ? "gacha-create-room-form" : undefined}
                  className="pp-btn gold"
                  disabled={ctaDisabled}
                  onClick={roomMode === "create" && !createdRoom ? undefined : handleCtaClick}
                  aria-busy={creatingRoom || joiningSeats !== null}
                >
                  {creatingRoom ? "CREATING…" : joiningSeats !== null ? "JOINING…" : ctaLabel}
                </button>
              </div>
            )
          }
        >
          {error && (
            <div role="alert" className="pp-flowalert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <span>{error}</span>
              <button type="button" aria-label="Dismiss message" onClick={() => setError(null)}>×</button>
            </div>
          )}

          {configsLoading && <div className="pp-roomstatus" role="status">Loading room sizes…</div>}

          {configsError && (
            <div className="pp-roomerror" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <span>{configsError}</span>
              <button type="button" onClick={() => { void loadConfigs(); }}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
              </button>
            </div>
          )}

          {seatSizes.length > 1 && !inviteCode && !rematchRoomId && (
            <div className="pp-sizetoggle">
              {seatSizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"pp-seg" + (pickedSeats === s ? " on" : "")}
                  disabled={joiningSeats !== null || creatingRoom}
                  onClick={() => {
                    if (directRoomId) router.replace("/app/gacha/play");
                    setError(null);
                    setInvitedRoom(null);
                    setPickedSeats(s);
                  }}
                >
                  {s} players
                </button>
              ))}
            </div>
          )}

          {activeConfig && (
            <div className="pp-lobbygrid">
              {previewMascots.map((key, i) => (
                <div key={i} className={"pp-slot" + (key ? " filled" : "")}>
                  {key ? <Mascot name={key} mood="none" size={56} /> : "?"}
                </div>
              ))}
            </div>
          )}

          {activeConfig && inviteLoading && (
            <div className="pp-roomstatus" role="status">Loading private room…</div>
          )}

          {activeConfig && rematchLoading && (
            <div className="pp-roomstatus" role="status">Loading your rematch room…</div>
          )}

          {activeConfig && rematchRoom && !rematchLoading && (
            <div className="pp-roomcreated" role="status">
              <span>{rematchRoom.isPrivate ? "Private rematch" : "Group rematch"}</span>
              <strong>{rematchRoom.name}</strong>
              <p>{rematchRoom.seatsFilled}/{rematchRoom.seats} original players joined · new players can fill any seats left open</p>
              {rematchClaimDeadline && <small>Original players have a short head start; you still approve a fresh payment below.</small>}
            </div>
          )}

          {activeConfig && invitedRoom && !createdRoom && !inviteLoading && (
            <div className="pp-roomcreated" role="status">
              <span>Private room invite</span>
              <strong>{invitedRoom.name}</strong>
              <p>{invitedRoom.seatsFilled}/{invitedRoom.seats} joined · only people with this link can join</p>
              <small>Devnet test entry · your wallet is topped up with test USDC when needed</small>
            </div>
          )}

          {activeConfig && existingRoom && !createdRoom && (
            <section className="pp-existingroom" aria-label="Current waiting room">
              <div className="pp-existingroom-copy">
                <span>{existingRoom.isPrivate ? "Private room · current seat" : "Public room · current seat"}</span>
                <strong>{existingRoom.name}</strong>
                <p>{existingRoom.seatsFilled}/{existingRoom.seats} joined · leave it before switching rooms</p>
              </div>
              <div className="pp-existingroom-actions">
                {existingRoom.isPrivate && existingRoom.inviteCode && (
                  <button type="button" className="pp-existingroom-open" onClick={() => { void copyInviteLink(existingRoom); }}>
                    <Copy className="h-4 w-4" aria-hidden="true" /> {copiedInvite ? "Copied" : "Copy invite"}
                  </button>
                )}
                <button type="button" className="pp-existingroom-open" onClick={() => router.push(roomHref(existingRoom))}>
                  Open room
                </button>
                <button type="button" className="pp-existingroom-leave" onClick={() => setShowLeaveConfirm(true)} disabled={leavingRoom}>
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Leave room
                </button>
              </div>
            </section>
          )}

          {activeConfig && roomMode === "browse" && !inviteCode && !rematchRoomId && (
            <div className="pp-browserlists">
            <div className="pp-roomlistwrap">
              <div className="pp-roomsectionhead">
                <span>Open rooms</span>
                <small>Pick a seat</small>
              </div>
              <div className="pp-roomlist" aria-busy={roomsLoading}>
                {roomsLoading && Array.from({ length: 2 }, (_, index) => (
                  <div key={index} className="pp-roomrow-skeleton" aria-hidden="true" />
                ))}

                {!roomsLoading && roomsError && (
                  <div className="pp-roomerror" role="alert">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <span>{roomsError}</span>
                    <button type="button" onClick={() => { void loadRooms(true); }}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                    </button>
                  </div>
                )}

                {!roomsLoading && !roomsError && rooms.length === 0 && (
                  <div className="pp-roomempty">
                    <p>No open rooms yet.</p>
                    <span>Create the first room for this size.</span>
                  </div>
                )}

                {!roomsLoading && !roomsError && rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className={"pp-roomrow" + (selectedRoomId === room.id ? " sel" : "")}
                    disabled={joiningSeats !== null || creatingRoom}
                    onClick={() => {
                      if (directRoomId) router.replace("/app/gacha/play");
                      setError(null);
                      setSelectedRoomId(room.id);
                      setCreatedRoom(null);
                    }}
                    aria-pressed={selectedRoomId === room.id}
                  >
                    <span className="pp-roomrow-avatars" aria-label={`${room.seatsFilled} players joined`}>
                      {room.participants.map((participant) => (
                        <span key={participant.seatNumber} className="pp-roomrow-avatar">
                          {participant.mascotKey
                            ? <Mascot name={participant.mascotKey} mood="none" size={28} />
                            : <span aria-hidden="true">?</span>}
                        </span>
                      ))}
                    </span>
                    <span className="pp-roomrow-info">
                      <span className="pp-roomrow-name">{room.name}</span>
                      <span className="pp-roomrow-fill">{room.seatsFilled}/{activeConfig.seats} joined</span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="pp-roomrow create"
                disabled={joiningSeats !== null || creatingRoom || !!existingRoom}
                onClick={startCreate}
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> Create room
              </button>
            </div>

            <section className="pp-livewrap" aria-labelledby="gacha-live-rooms-title">
              <div className="pp-roomsectionhead">
                <span id="gacha-live-rooms-title">Live now</span>
                <small>Watch free</small>
              </div>

              {activeRoomsLoading && (
                <div className="pp-roomrow-skeleton" role="status" aria-label="Loading live rooms" />
              )}

              {!activeRoomsLoading && activeRoomsError && (
                <div className="pp-roomerror" role="alert">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <span>{activeRoomsError}</span>
                  <button type="button" onClick={() => { void loadActiveRooms(true); }}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                  </button>
                </div>
              )}

              {!activeRoomsLoading && !activeRoomsError && activeRooms.length === 0 && (
                <div className="pp-liveempty">
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  <span>No games live right now. The next full room will appear here.</span>
                </div>
              )}

              {!activeRoomsLoading && !activeRoomsError && activeRooms.map((liveRoom) => (
                <Link
                  key={liveRoom.id}
                  href={`/app/gacha/${encodeURIComponent(liveRoom.id)}?spectate=1`}
                  className="pp-liveroomrow"
                  aria-label={`Watch ${liveRoom.name}, ${liveRoom.seatsFilled} of ${liveRoom.seats} players`}
                >
                  <span className="pp-roomrow-avatars" aria-hidden="true">
                    {liveRoom.participants.map((participant) => (
                      <span key={participant.seatNumber} className="pp-roomrow-avatar">
                        {participant.mascotKey
                          ? <Mascot name={participant.mascotKey} mood="none" size={28} />
                          : <span>?</span>}
                      </span>
                    ))}
                  </span>
                  <span className="pp-roomrow-info">
                    <span className="pp-roomrow-name">{liveRoom.name}</span>
                    <span className="pp-roomrow-fill">{liveRoom.seatsFilled}/{liveRoom.seats} players · {liveStatusLabel(liveRoom.status)}</span>
                  </span>
                  <span className="pp-watchaction"><Eye className="h-4 w-4" aria-hidden="true" /> Watch</span>
                </Link>
              ))}
            </section>
            </div>
          )}

          {activeConfig && roomMode === "create" && !createdRoom && !rematchRoomId && (
            <form
              id="gacha-create-room-form"
              className="pp-createcard"
              onSubmit={(event) => { event.preventDefault(); void handleCreateRoom(); }}
            >
              <label className="pp-namelabel" htmlFor="gacha-room-name">Room name</label>
              <input
                id="gacha-room-name"
                className="pp-nameinput"
                value={roomName}
                onChange={(e) => { setRoomName(e.target.value); setRoomNameEdited(true); }}
                maxLength={24}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!roomName.trim()}
                aria-describedby={!roomName.trim() ? "gacha-room-name-error" : undefined}
                placeholder="Room #1"
              />
              {!roomName.trim() && <p id="gacha-room-name-error" className="pp-field-error">Enter a room name.</p>}
              <div className="pp-privaterow">
                <span className="pp-privaterow-label">
                  {isPrivate && <Lock className="w-3.5 h-3.5" aria-hidden="true" />} Private room
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Create a private room"
                  aria-checked={isPrivate}
                  className={"pp-switch" + (isPrivate ? " on" : "")}
                  onClick={() => setIsPrivate((value) => !value)}
                >
                  <span className="pp-switch-knob" />
                </button>
              </div>
              {isPrivate && <p className="pp-privatehint">Only people with the invite link will be able to join this room.</p>}
              <button type="button" className="pp-roomlist-back" onClick={() => { setRoomMode("browse"); setCreatedRoom(null); }}>
                ← back to rooms
              </button>
            </form>
          )}

          {activeConfig && createdRoom && (
            <div className="pp-roomcreated" role="status">
              <span>{createdRoom.isPrivate ? "Private" : "Public"} room created</span>
              <strong>{createdRoom.name}</strong>
              <p>{createdRoom.isPrivate ? "Share the invite link, then join this room to take the first seat." : "Join this room to take the first seat."}</p>
            </div>
          )}

        </Shell>
      )}

      <AlertDialog open={showLeaveConfirm} onOpenChange={(open) => { if (!leavingRoom) setShowLeaveConfirm(open); }}>
        <AlertDialogContent className="border-white/10 bg-[#0f0f12] text-white sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {existingRoom?.name ?? "this room"}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              Your waiting seat will be released so you can join another room. Your Devnet test entry is not refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leavingRoom} className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
              Keep my seat
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={leavingRoom}
              onClick={(event) => { event.preventDefault(); void handleLeaveRoom(); }}
              className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-300"
            >
              {leavingRoom ? "Leaving…" : "Leave room"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
