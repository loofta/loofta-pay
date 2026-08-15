"use client";

// Gacha "Rip Party" — pick your mascot, then pick a room size (which is when the actual
// join-tx/payment happens). Fully chromeless (see AppShell's isGachaRoomPage) — the explainer +
// Start button live at /app/gacha instead, which keeps the normal app header. See
// apps/backend/src/modules/gacha for the room lifecycle this leads into (waiting -> purchasing ->
// opening (rip) -> excluding (roulette) -> voting (cut one more?) -> settled).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { AlertCircle, ChevronLeft, Lock, Plus, RefreshCw } from "lucide-react";
import MascotPicker from "@/components/MascotPicker";
import { Shell } from "@/components/PackParty";
import Mascot from "@/components/Mascot";
import { getMascot } from "@/lib/mascots";

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
  createdAt: string;
  participants: Array<{ seatNumber: number; mascotKey: string | null }>;
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
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find((w) => w.address === embeddedSolAddress) ?? wallets[0];

  const [stage, setStage] = useState<Stage>("pick");
  const [configs, setConfigs] = useState<RoomConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [mascotKey, setMascotKey] = useState<string | null>(null);
  const [pickedSeats, setPickedSeats] = useState<number | null>(null);
  const [joiningSeats, setJoiningSeats] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<WaitingRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomMode, setRoomMode] = useState<RoomMode>("browse");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomNameEdited, setRoomNameEdited] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<WaitingRoom | null>(null);
  const roomsRequestIdRef = useRef(0);

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
    if (pickedSeats === null && seatSizes.length) setPickedSeats(seatSizes[0]);
  }, [pickedSeats, seatSizes]);
  const activeConfig = enabledConfigs.find((c) => c.seats === pickedSeats) ?? null;

  const loadRooms = useCallback(async (showLoading = false) => {
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
      setSelectedRoomId((current) => nextRooms.some((room) => room.id === current) ? current : (nextRooms[0]?.id ?? null));
    } catch {
      if (requestId !== roomsRequestIdRef.current) return;
      setRoomsError("Couldn't load open rooms. This is usually a network hiccup.");
    } finally {
      if (requestId === roomsRequestIdRef.current) setRoomsLoading(false);
    }
  }, [activeConfig]);

  useEffect(() => {
    if (!activeConfig) return;
    roomsRequestIdRef.current += 1;
    void loadRooms(true);
    const interval = window.setInterval(() => { void loadRooms(false); }, 5_000);
    return () => {
      window.clearInterval(interval);
      roomsRequestIdRef.current += 1;
    };
  }, [activeConfig, loadRooms]);

  // Changing size invalidates a picked/created room. loadRooms selects the first result, and the
  // backend returns rooms fullest-first so the room closest to starting becomes the default.
  useEffect(() => {
    setRoomMode("browse");
    setCreatedRoom(null);
    setSelectedRoomId(null);
  }, [pickedSeats]);

  const selectedRoom = createdRoom ?? rooms.find((room) => room.id === selectedRoomId) ?? null;
  // Filled seat previews show only confirmed participants. Creating a room does not take a seat
  // or charge the entry yet; the creator appears here only after the explicit paid join succeeds.
  const previewMascots: (string | null)[] = Array.from({ length: activeConfig?.seats ?? 0 }, (_, i) => {
    if (selectedRoom) return selectedRoom.participants.find((participant) => participant.seatNumber === i + 1)?.mascotKey ?? null;
    return null;
  });

  const startCreate = useCallback(() => {
    const fallbackName = `Room #${rooms.length + 1}`;
    setRoomMode("create");
    setSelectedRoomId(null);
    setCreatedRoom(null);
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
  }, [rooms.length, activeConfig]);

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
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Failed to create room");
      const room: WaitingRoom = await response.json();
      setCreatedRoom(room);
      setSelectedRoomId(room.id);
      if (!room.isPrivate) setRooms((current) => [...current.filter((item) => item.id !== room.id), room]);
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Couldn't create the room — please try again.");
    } finally {
      setCreatingRoom(false);
    }
  }, [activeConfig, roomName, roomNameEdited, isPrivate, authenticated, login, getAccessToken]);

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

        const joinTxRes = await fetch(`/api/gacha/rooms/${targetRoom.id}/join-tx`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
        });
        if (!joinTxRes.ok) throw new Error((await joinTxRes.json().catch(() => null))?.message ?? "Failed to prepare entry payment");
        const { txBase64, roomId, alreadyJoined } = await joinTxRes.json();

        // Already have a seat in a waiting room for this config — nothing to sign, just go there.
        if (alreadyJoined) { router.push(`/app/gacha/${roomId}`); return; }

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

        const joinRes = await fetch(`/api/gacha/rooms/${roomId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ paymentTxHash, mascotKey }),
        });
        if (!joinRes.ok) throw new Error((await joinRes.json().catch(() => null))?.message ?? "Failed to join room");

        router.push(`/app/gacha/${roomId}`);
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

  const pickedMascot = getMascot(mascotKey);

  const ctaLabel = createdRoom
    ? `JOIN ${createdRoom.name.toUpperCase()} FOR $${createdRoom.entryUsdc.toFixed(2)} →`
    : roomMode === "create"
      ? "CREATE ROOM →"
      : selectedRoom
        ? activeConfig && `JOIN ${selectedRoom.name.toUpperCase()} FOR $${activeConfig.entryUsdc.toFixed(2)} →`
        : "SELECT A ROOM";
  const ctaDisabled =
    configsLoading || roomsLoading || creatingRoom || joiningSeats !== null
    || (roomMode === "create" && !createdRoom && !roomName.trim())
    || (roomMode === "browse" && !selectedRoom && !createdRoom);
  const handleCtaClick = () => {
    if (!activeConfig) return;
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

      {error && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 w-full max-w-md px-5">
          <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>
        </div>
      )}

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

          {seatSizes.length > 1 && (
            <div className="pp-sizetoggle">
              {seatSizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"pp-seg" + (pickedSeats === s ? " on" : "")}
                  disabled={joiningSeats !== null || creatingRoom}
                  onClick={() => setPickedSeats(s)}
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

          {activeConfig && roomMode === "browse" && (
            <div className="pp-roomlistwrap">
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
                    onClick={() => { setSelectedRoomId(room.id); setCreatedRoom(null); }}
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
                disabled={joiningSeats !== null || creatingRoom}
                onClick={startCreate}
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> Create room
              </button>
            </div>
          )}

          {activeConfig && roomMode === "create" && !createdRoom && (
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
              {isPrivate && <p className="pp-privatehint">Visibility will be saved. Shareable invite links arrive in the private-room follow-up.</p>}
              <button type="button" className="pp-roomlist-back" onClick={() => { setRoomMode("browse"); setCreatedRoom(null); }}>
                ← back to rooms
              </button>
            </form>
          )}

          {activeConfig && createdRoom && (
            <div className="pp-roomcreated" role="status">
              <span>{createdRoom.isPrivate ? "Private" : "Public"} room created</span>
              <strong>{createdRoom.name}</strong>
              <p>Join this room to take the first seat.</p>
            </div>
          )}

        </Shell>
      )}
    </div>
  );
}
