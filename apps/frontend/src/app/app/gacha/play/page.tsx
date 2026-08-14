"use client";

// Gacha "Rip Party" — pick your mascot, then pick a room size (which is when the actual
// join-tx/payment happens). Fully chromeless (see AppShell's isGachaRoomPage) — the explainer +
// Start button live at /app/gacha instead, which keeps the normal app header. See
// apps/backend/src/modules/gacha for the room lifecycle this leads into (waiting -> purchasing ->
// opening (rip) -> excluding (roulette) -> voting (cut one more?) -> settled).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ChevronLeft, Lock, Copy, Check, Plus } from "lucide-react";
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

// UI-only mock for LOO-6/LOO-7 (room browser + create/join, private rooms) — no backend room-list
// or per-room-join API exists yet. Selecting or creating a room here only changes what's shown;
// the actual payment/join underneath still calls the same config-level join-tx flow it always
// has (handleJoin below), which auto-assigns a backend room exactly like before this UI existed.
// Swap this mock data + the TODOs in handleCreateRoom/handleJoin for real API calls once LOO-6
// ships a per-room join endpoint.
interface MockRoom {
  id: string;
  name: string;
  filled: number;
  joined: string[]; // mascot keys of players already seated, for the "who's joined" preview
}
const MOCK_ROOMS_BY_SEATS: Record<number, MockRoom[]> = {
  5: [
    { id: "mock-5-1", name: "Room #1", filled: 3, joined: ["fox", "bear", "penguin"] },
    { id: "mock-5-2", name: "Room #2", filled: 1, joined: ["cat"] },
  ],
  10: [{ id: "mock-10-1", name: "Room #1", filled: 6, joined: ["fox", "bear", "penguin", "dog", "chick", "bunny"] }],
};

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
  const [mascotKey, setMascotKey] = useState<string | null>(null);
  const [pickedSeats, setPickedSeats] = useState<number | null>(null);
  const [joiningSeats, setJoiningSeats] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [roomMode, setRoomMode] = useState<RoomMode>("browse");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ name: string; isPrivate: boolean; shareUrl: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [spectatingId, setSpectatingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gacha/configs").then((r) => (r.ok ? r.json() : [])).then(setConfigs).catch(() => {});
  }, []);

  const enabledConfigs = configs.filter((c) => c.enabled);
  const seatSizes = Array.from(new Set(enabledConfigs.map((c) => c.seats))).sort((a, b) => a - b);
  useEffect(() => {
    if (pickedSeats === null && seatSizes.length) setPickedSeats(seatSizes[0]);
  }, [pickedSeats, seatSizes]);
  const activeConfig = enabledConfigs.find((c) => c.seats === pickedSeats) ?? null;

  const mockRooms = useMemo(() => MOCK_ROOMS_BY_SEATS[pickedSeats ?? 0] ?? [], [pickedSeats]);

  // Changing room size invalidates whatever room was picked/created/spectated for the old size.
  // Default to the fullest room (closest to starting) rather than making the player pick first —
  // they can still switch to any other room in the list below.
  useEffect(() => {
    setRoomMode("browse");
    setCreatedRoom(null);
    setSpectatingId(null);
    setLinkCopied(false);
    const rooms = MOCK_ROOMS_BY_SEATS[pickedSeats ?? 0] ?? [];
    const fullest = rooms.reduce<MockRoom | null>((best, r) => (!best || r.filled > best.filled ? r : best), null);
    setSelectedRoomId(fullest?.id ?? null);
  }, [pickedSeats]);

  const selectedRoom = mockRooms.find((r) => r.id === selectedRoomId) ?? null;
  // Filled seat previews show the actual joined mascots (same data as the room-list avatars),
  // not a generic dot — the creator's own picked mascot fills seat 0 once they've created a room.
  const previewMascots: (string | null)[] = Array.from({ length: activeConfig?.seats ?? 0 }, (_, i) => {
    if (createdRoom) return i === 0 ? mascotKey : null;
    if (selectedRoom) return selectedRoom.joined[i] ?? null;
    return null;
  });

  const startCreate = useCallback(() => {
    setRoomMode("create");
    setSelectedRoomId(null);
    setRoomName(`Room #${mockRooms.length + 1}`);
    setIsPrivate(false);
  }, [mockRooms.length]);

  const handleCreateRoom = useCallback(() => {
    if (!roomName.trim()) return;
    const code = Math.random().toString(36).slice(2, 8);
    setCreatedRoom({
      name: roomName.trim(),
      isPrivate,
      shareUrl: `${typeof window !== "undefined" ? window.location.origin : "https://pay.loofta.xyz"}/app/gacha/join/${code}`,
    });
  }, [roomName, isPrivate]);

  const handleCopyLink = useCallback(() => {
    if (!createdRoom) return;
    navigator.clipboard?.writeText(createdRoom.shareUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [createdRoom]);

  // MascotPicker normally locks a mascot to an already-joined room seat over the socket — here
  // there's no room yet, so this just captures the local pick and advances the flow.
  const handleLocalMascotPick = useCallback(async (key: string) => {
    setMascotKey(key);
    setStage("size");
    return { ok: true };
  }, []);

  const handleJoin = useCallback(
    async (configKey: string, seats: number) => {
      if (!authenticated) { login(); return; }
      if (!embeddedWallet?.address) { setError("No Solana wallet found"); return; }
      if (!mascotKey) { setStage("pick"); return; }
      setJoiningSeats(seats);
      setError(null);
      try {
        const token = await getAccessToken();
        const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const joinTxRes = await fetch("/api/gacha/rooms/join-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ configKey }),
        });
        if (!joinTxRes.ok) throw new Error((await joinTxRes.json().catch(() => null))?.message ?? "Failed to prepare entry payment");
        const { txBase64, roomId, alreadyJoined } = await joinTxRes.json();

        // Already have a seat in a waiting room for this config — nothing to sign, just go there.
        if (alreadyJoined) { router.push(`/app/gacha/${roomId}`); return; }

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
      } finally {
        setJoiningSeats(null);
      }
    },
    [authenticated, login, embeddedWallet, mascotKey, getAccessToken, signAndSendTransaction, router],
  );

  const pickedMascot = getMascot(mascotKey);

  const ctaLabel = createdRoom
    ? "ENTER ROOM →"
    : roomMode === "create"
      ? activeConfig && `CREATE ROOM FOR $${activeConfig.entryUsdc.toFixed(2)} →`
      : selectedRoom
        ? activeConfig && `JOIN ${selectedRoom.name.toUpperCase()} FOR $${activeConfig.entryUsdc.toFixed(2)} →`
        : "SELECT A ROOM";
  const ctaDisabled =
    joiningSeats !== null || (roomMode === "create" && !createdRoom && !roomName.trim()) || (roomMode === "browse" && !selectedRoom && !createdRoom);
  const handleCtaClick = () => {
    if (!activeConfig) return;
    if (createdRoom) { handleJoin(activeConfig.configKey, activeConfig.seats); return; }
    if (roomMode === "create") { handleCreateRoom(); return; }
    if (selectedRoom) handleJoin(activeConfig.configKey, activeConfig.seats);
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
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>
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
              spectatingId ? (
                <button type="button" className="pp-btn ghost" onClick={() => setSpectatingId(null)}>
                  STOP SPECTATING
                </button>
              ) : (
                <div className="pp-sharewrap">
                  {createdRoom && (
                    <button type="button" className="pp-btn ghost" onClick={handleCopyLink}>
                      {linkCopied ? (
                        <span className="pp-btn-icon"><Check className="w-4 h-4" /> LINK COPIED</span>
                      ) : (
                        <span className="pp-btn-icon"><Copy className="w-4 h-4" /> COPY INVITE LINK</span>
                      )}
                    </button>
                  )}
                  <button type="button" className="pp-btn gold" disabled={ctaDisabled} onClick={handleCtaClick}>
                    {joiningSeats !== null ? "JOINING…" : ctaLabel}
                  </button>
                </div>
              )
            )
          }
        >
          {seatSizes.length > 1 && (
            <div className="pp-sizetoggle">
              {seatSizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"pp-seg" + (pickedSeats === s ? " on" : "")}
                  disabled={joiningSeats !== null}
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
              <div className="pp-roomlist">
                {mockRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={"pp-roomrow" + (selectedRoomId === r.id && !spectatingId ? " sel" : "")}
                    disabled={joiningSeats !== null}
                    onClick={() => { setSelectedRoomId(r.id); setSpectatingId(null); }}
                  >
                    <span className="pp-roomrow-info">
                      <span className="pp-roomrow-name">{r.name}</span>
                      <span className="pp-roomrow-fill">{r.filled}/{activeConfig.seats} joined</span>
                    </span>
                    <span
                      className="pp-roomrow-spectate"
                      onClick={(e) => { e.stopPropagation(); setSpectatingId(r.id); }}
                    >
                      {spectatingId === r.id ? "Watching" : "Spectate"}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="pp-roomrow create"
                disabled={joiningSeats !== null}
                onClick={() => { startCreate(); setSpectatingId(null); }}
              >
                <Plus className="w-4 h-4" /> Create room
              </button>
            </div>
          )}

          {activeConfig && roomMode === "create" && !createdRoom && (
            <div className="pp-createcard">
              <input
                className="pp-nameinput"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={24}
                placeholder="Room name"
              />
              <div className="pp-privaterow">
                <span className="pp-privaterow-label">
                  {isPrivate && <Lock className="w-3.5 h-3.5" />} Private room
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPrivate}
                  className={"pp-switch" + (isPrivate ? " on" : "")}
                  onClick={() => setIsPrivate((v) => !v)}
                >
                  <span className="pp-switch-knob" />
                </button>
              </div>
              {isPrivate && <p className="pp-privatehint">Only people with the invite link can join — you'll get a share link after creating.</p>}
              <button type="button" className="pp-roomlist-back" onClick={() => setRoomMode("browse")}>
                ← back to rooms
              </button>
            </div>
          )}

        </Shell>
      )}
    </div>
  );
}
