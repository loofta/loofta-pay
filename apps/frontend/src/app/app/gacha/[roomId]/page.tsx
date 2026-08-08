"use client";

// Gacha room — the whole pooled-pack lifecycle on one page: lobby (waiting for seats + mascot
// lock-in) -> VRF exclusion draw -> pack purchase/open -> ready check -> 3D rip -> settlement ->
// claim (public or private). Backend contract:
// apps/backend/src/modules/gacha/{gacha.service,gacha.controller,gacha.gateway}.ts.
// Live updates come from useGachaRoomSocket (GachaGateway); every event just triggers a REST
// refetch rather than trying to hand-merge partial deltas into local state — events are
// infrequent (a handful over a room's whole lifetime), so simplicity wins over shaving a request.
//
// No click-to-open: every participant marks themselves ready (see the ready UI below), and once
// the backend sees everyone has, `room:all_ready` fires and the 3D rip plays automatically for
// everyone watching, in sync — nobody taps anything to start it. The old room-participants-only
// bid auction that used to follow the reveal is gone — replaced by a MagicBlock-VRF exclusion
// draw that runs BEFORE the pack is even purchased (see the 'excluding' status below); the
// bid-auction backend code (gacha_bids, advanceToNextBidCandidate, etc.) still exists but is
// unreachable from this new flow — left dormant rather than deleted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ChevronLeft } from "lucide-react";
import GachaPack from "@/components/GachaPack";
import GachaCard from "@/components/GachaCard";
import PokerTable from "@/components/PokerTable";
import CardAttributesPanel from "@/components/CardAttributesPanel";
import MascotPicker from "@/components/MascotPicker";
import ExclusionReveal from "@/components/ExclusionReveal";
import { getMascot } from "@/lib/mascots";
import type { GachaOpenResult, GachaRarity, GachaNftAttribute } from "@/components/GachaPack3D";
import { useGachaRoomSocket } from "@/hooks/useGachaRoomSocket";

// Client-only (touches window/WebGL) — same ssr:false convention as MegapotPack's own usage.
const GachaPack3D = dynamic(() => import("@/components/GachaPack3D"), { ssr: false });

interface RoomDetail {
  room: {
    id: string;
    configKey: string;
    packType: string;
    seats: number;
    entryUsdc: number;
    exclusionCount: number;
    status: string;
    seatsFilled: number;
    nftMetadata: { image?: string; backImage?: string; name?: string; insuredValueUsdc?: number; attributes?: GachaNftAttribute[] } | null;
    rarity: string | null;
    buybackAmountUsdc: number | null;
    bidWindowEndsAt: string | null;
    createdAt: string;
  };
  myParticipant: {
    seatNumber: number;
    payoutUsdc: number | null;
    payoutIsPrivate: boolean | null;
    claimed: boolean;
    mascotKey: string | null;
    mascotLocked: boolean;
    excluded: boolean;
  } | null;
  bestBid: { amountUsdc: number } | null;
  pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
  participants: Array<{ seatNumber: number; username: string | null; isMe: boolean; mascotKey: string | null; mascotLocked: boolean; excluded: boolean }>;
}

const READY_SECONDS = 30;

const RARITY_STYLE: Record<string, string> = {
  common: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  uncommon: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rare: "border-purple-400/30 bg-purple-400/10 text-purple-300",
  epic: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

export default function GachaRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find((w) => w.address === embeddedSolAddress) ?? wallets[0];

  const [accessToken, setAccessToken] = useState<string | null>(null);
  useEffect(() => { getAccessToken().then(setAccessToken).catch(() => setAccessToken(null)); }, [getAccessToken]);

  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);

  // Mirrors `detail` for waitForReveal's poll loop below (a plain closure captured once inside
  // GachaPack3D's resolveOpen prop would otherwise see a stale, first-render `detail`).
  const detailRef = useRef<RoomDetail | null>(null);
  useEffect(() => { detailRef.current = detail; }, [detail]);

  // Whether the room's card was already revealed the FIRST time this page ever loaded detail —
  // if so, there's no live moment to animate (whoever was watching live already saw it), so the
  // 3D rip experience is skipped entirely in favor of just showing the settled result. Only set
  // once, from the very first fetch.
  const arrivedAlreadyRevealedRef = useRef<boolean | null>(null);
  // Flips true once GachaPack3D's own reveal animation (shake -> burst) has actually finished
  // playing for a user who WAS watching live — separate from the room's own `nftMetadata`
  // becoming non-null, which typically lands slightly earlier (mid-shake).
  const [played3DReveal, setPlayed3DReveal] = useState(false);
  // Captured directly from GachaPack3D's onOpened callback — shown via GachaCard regardless of
  // whether this page's own polling has caught up to the same data yet.
  const [revealedCard, setRevealedCard] = useState<GachaOpenResult | null>(null);

  // Ready-to-open gate — see the file header comment. Marking ready is a one-way local action;
  // "all ready" is authoritative from the server (room:all_ready), never inferred client-side.
  const [iAmReady, setIAmReady] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const showGachaDevTools = process.env.NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS === "true";
  const [fillingBots, setFillingBots] = useState(false);
  const [forceSettling, setForceSettling] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const res = await fetch(`/api/gacha/rooms/${roomId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return;
    const data: RoomDetail = await res.json();
    if (arrivedAlreadyRevealedRef.current === null) arrivedAlreadyRevealedRef.current = !!data.room.nftMetadata;
    setDetail(data);
  }, [roomId, accessToken]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const { lastUpdate, lastOpened, lastSettled, lastExcluded, lastReadyUpdate, allReadyTick, readySeats, markReady, lockMascot } = useGachaRoomSocket(roomId, accessToken);
  useEffect(() => { refresh(); }, [lastUpdate, lastOpened, lastSettled, lastExcluded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (allReadyTick > 0) setAutoOpen(true); }, [allReadyTick]);

  // Drives the full-screen ExclusionReveal takeover below — stays true for the whole cinematic
  // sequence regardless of what room.status has moved on to underneath by the time it finishes.
  const [exclusionRevealActive, setExclusionRevealActive] = useState(false);
  useEffect(() => { if (lastExcluded) setExclusionRevealActive(true); }, [lastExcluded]);

  const room = detail?.room;

  // GachaPack3D's resolveOpen contract: unlike Mystery Pack, the pack doesn't START a purchase
  // when the reveal triggers (the room already bought and is opening the pack automatically the
  // moment it filled) — it just waits for that already-in-flight process to finish, polling the
  // same `detail` state this page's own 5s interval + websocket-triggered refreshes keep current.
  const waitForReveal = useCallback((): Promise<GachaOpenResult> => {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 90_000; // generous — matches the backend's own ~60s openPack poll ceiling plus buffer
      const check = () => {
        const nft = detailRef.current?.room.nftMetadata;
        // Only nftMetadata gates the reveal — rarity is cosmetic (a badge/border color) and
        // Collector Crypt doesn't always return one of our 4 known tiers, so it can legitimately
        // be null. Requiring it truthy here used to leave the pack shaking forever whenever that
        // happened, since nothing ever flips it non-null. Same "common" fallback the flat/no-3D
        // render path already uses below.
        if (nft) { resolve({ nftMetadata: nft, rarity: (detailRef.current?.room.rarity ?? "common") as GachaRarity }); return; }
        if (detailRef.current?.room.status === "failed") { reject(new Error("This room ran into a problem opening the pack.")); return; }
        if (Date.now() > deadline) { reject(new Error("Taking longer than expected — check back in a moment.")); return; }
        setTimeout(check, 700);
      };
      check();
    });
  }, []);

  const handleJoin = useCallback(async () => {
    if (!authenticated) { login(); return; }
    if (!embeddedWallet?.address || !room) { setError("No Solana wallet found"); return; }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const joinTxRes = await fetch("/api/gacha/rooms/join-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ configKey: room.configKey, userSolanaAddress: embeddedWallet.address }),
      });
      if (!joinTxRes.ok) throw new Error((await joinTxRes.json().catch(() => null))?.message ?? "Failed to prepare entry payment");
      const { txBase64, roomId: targetRoomId, alreadyJoined } = await joinTxRes.json();

      // Already have a seat in a waiting room for this config — nothing to sign, just go there.
      if (alreadyJoined) {
        if (targetRoomId !== roomId) router.replace(`/app/gacha/${targetRoomId}`); else refresh();
        return;
      }

      const txBytes = Buffer.from(txBase64, "base64");
      // Gacha Pooled Packs is devnet-only end to end — omitting `chain` defaults to
      // solana:mainnet, which fails simulation against this devnet-built transaction.
      const { signature: sigBytes } = await signAndSendTransaction({ transaction: txBytes as unknown as Uint8Array, wallet: embeddedWallet as any, chain: "solana:devnet" });
      const paymentTxHash = bs58.encode(sigBytes as Uint8Array);

      const joinRes = await fetch(`/api/gacha/rooms/${targetRoomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ paymentTxHash }),
      });
      if (!joinRes.ok) throw new Error((await joinRes.json().catch(() => null))?.message ?? "Failed to join room");

      // findOrCreateWaitingRoom can land a seat in a DIFFERENT room of the same config if this
      // one filled up between page load and this click — follow it rather than showing a stale page.
      if (targetRoomId !== roomId) router.replace(`/app/gacha/${targetRoomId}`);
      else refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Couldn't join right now — please try again.");
    } finally {
      setBusy(false);
    }
  }, [authenticated, login, embeddedWallet, room, roomId, getAccessToken, signAndSendTransaction, router, refresh]);

  const handleFillWithBots = useCallback(async () => {
    setFillingBots(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/gacha/rooms/${roomId}/fill-with-bots`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to fill with bots");
      // Bots trickle in server-side over the next several seconds — the existing 5s poll +
      // websocket room:update events pick each one up as it lands, same as a real join. Stay
      // disabled ("Filling…") through that whole trickle, not just this request's own round
      // trip: the backend computes how many bots to add ONCE per call, so re-clicking mid-trickle
      // used to fire a second overlapping fill that raced the first (confirmed live — one bot's
      // real on-chain join lands, then its DB insert 400s with "room is full" because a bot from
      // the other overlapping call already took the last seat). The button naturally disappears
      // once room.status leaves "waiting" (see its render guard below), so this only needs to
      // stay true through a successful call — only reset it on failure, so a real error lets you
      // retry immediately.
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Failed to fill with bots.");
      setFillingBots(false);
    }
  }, [roomId, getAccessToken]);

  const handleForceSettle = useCallback(async () => {
    setForceSettling(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/gacha/rooms/${roomId}/force-exclude`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to force the exclusion draw");
      refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Failed to force the exclusion draw.");
    } finally {
      setForceSettling(false);
    }
  }, [roomId, getAccessToken, refresh]);

  const handleMarkReady = useCallback(() => {
    setIAmReady(true);
    markReady();
  }, [markReady]);

  // Same "don't let one distracted player stall the room" pattern as MascotPicker's own 30s
  // timer — the ready-gate used to wait indefinitely for a manual click with no fallback. Mirrors
  // showReadyGate's own condition (computed again below from the same source state, since that
  // const is declared after the early-return and hooks can't live there).
  const [readyCountdown, setReadyCountdown] = useState(READY_SECONDS);
  const readyGateEligible = !arrivedAlreadyRevealedRef.current && !played3DReveal
    && detail?.room.status !== "failed" && detail?.room.status !== "cancelled"
    && !!detail?.room.nftMetadata && !!detail?.myParticipant && !autoOpen;
  useEffect(() => {
    if (!readyGateEligible || iAmReady) return;
    setReadyCountdown(READY_SECONDS);
    const interval = setInterval(() => setReadyCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
  }, [readyGateEligible, iAmReady]);
  useEffect(() => {
    if (readyGateEligible && !iAmReady && readyCountdown === 0) handleMarkReady();
  }, [readyCountdown, readyGateEligible, iAmReady, handleMarkReady]);

  const handleLockMascot = useCallback(async (mascotKey: string) => {
    const res = await lockMascot(mascotKey);
    if (res.ok) refresh();
    return res;
  }, [lockMascot, refresh]);

  const handleClaim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/gacha/rooms/${roomId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ isPrivate }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Claim failed");
      refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Claim failed — please try again.");
    } finally {
      setBusy(false);
    }
  }, [roomId, isPrivate, getAccessToken, refresh]);

  const statusCaption = useMemo(() => {
    if (!room) return "";
    switch (room.status) {
      case "waiting": return `Waiting for ${room.seats - room.seatsFilled} more player${room.seats - room.seatsFilled === 1 ? "" : "s"}…`;
      case "excluding": return "Running the exclusion draw…";
      case "purchasing": return "Buying the pack…";
      case "opening": return "Opening the pack…";
      case "bidding": return "Bidding is open";
      case "settling": return "Settling…";
      case "settled": return "Settled";
      case "cancelled": return "Cancelled";
      case "failed": return "Something went wrong with this room — contact support";
      default: return room.status;
    }
  }, [room]);

  if (!detail || !room) {
    return <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100 flex items-center justify-center text-base">Loading room…</div>;
  }

  // See the refs/state above: the 3D rip experience only ever plays once, for whoever is
  // actually watching live — everyone else (already-revealed on first load, or already watched
  // it once this session) gets the flat settled view straight away.
  // Terminal failure states never get a card to reveal — fall straight to the flat/back-face
  // view + statusCaption instead of leaving the idle pack animation spinning on a "waiting for
  // everyone" message that will never resolve.
  const show3D = !arrivedAlreadyRevealedRef.current && !played3DReveal && room.status !== "failed" && room.status !== "cancelled";
  const cardResult: GachaOpenResult | null = revealedCard ?? (room.nftMetadata ? { nftMetadata: room.nftMetadata, rarity: (room.rarity ?? "common") as GachaRarity } : null);
  // Gated on nftMetadata actually existing (not just status !== "waiting") — the room sits in
  // "purchasing"/"opening" for real seconds-to-a-minute before the pack API even returns a card,
  // and showing "waiting for everyone to be ready" during that window is misleading: there is
  // nothing yet for anyone to be ready to watch.
  const showReadyGate = show3D && !!room.nftMetadata && !!detail.myParticipant && !autoOpen;
  // Mascot lock-in is its own isolated screen — no poker table, no pack behind it — so it reads
  // as "pick your character" before the room itself is shown, arcade-select-screen style. Once
  // locked, this flips off and the big poker-table "everyone's here" view takes over.
  const isPicking = room.status === "waiting" && !!detail.myParticipant && !detail.myParticipant.mascotLocked;

  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      {exclusionRevealActive && lastExcluded && (
        <ExclusionReveal
          excludedSeatNumbers={lastExcluded.excludedSeatNumbers}
          getMascotForSeat={(seatNumber) => getMascot(detail.participants.find((p) => p.seatNumber === seatNumber)?.mascotKey)}
          onDone={() => setExclusionRevealActive(false)}
        />
      )}
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <Link href="/app/gacha" className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-base">
            <ChevronLeft className="w-4 h-4" /> Rooms
          </Link>
          <span className="text-slate-400 text-base">{room.seatsFilled}/{room.seats} players · ${room.entryUsdc.toFixed(2)} each</span>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>}

        {isPicking ? (
          <div className="min-h-[60vh] flex items-center justify-center py-8">
            <div className="w-full max-w-lg">
              <MascotPicker lockedMascotKey={null} onLock={handleLockMascot} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 mb-8">
              <div className="w-full -mb-4 relative z-10">
                <PokerTable
                  seats={room.seats}
                  participants={detail.participants}
                  readySeats={readySeats}
                  size={room.status === "waiting" || room.status === "excluding" ? "hero" : "compact"}
                  excludedSeats={detail.participants.filter((p) => p.excluded).map((p) => p.seatNumber)}
                  spinning={room.status === "excluding" && !lastExcluded}
                />
              </div>
              {show3D ? (
                room.status === "waiting" || room.status === "excluding" ? (
                  <GachaPack width={180} />
                ) : (
                  <div className="w-full h-[460px] sm:h-[560px] rounded-2xl overflow-hidden">
                    <GachaPack3D
                      autoOpen={autoOpen}
                      resolveOpen={waitForReveal}
                      onOpened={(result) => { setRevealedCard(result); setPlayed3DReveal(true); }}
                      onError={(err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open the pack right now.")}
                      idleSubtitle={autoOpen ? statusCaption : "Waiting for everyone to be ready…"}
                      openingLabel={statusCaption}
                    />
                  </div>
                )
              ) : cardResult ? (
                <div className="w-full flex flex-col sm:flex-row items-center sm:items-start justify-center gap-6">
                  <GachaCard
                    width={220}
                    card={{
                      name: cardResult.nftMetadata?.name ?? "Mystery Card",
                      rarity: cardResult.rarity,
                      // faceImage/backImage render the actual Collector Crypt scan edge-to-edge, no
                      // Loofta frame — `image` alone would cover the illustration in the branded pack
                      // art instead, which is exactly what real card reveals shouldn't look like.
                      faceImage: cardResult.nftMetadata?.image,
                      backImage: cardResult.nftMetadata?.backImage,
                    }}
                  />
                  <CardAttributesPanel
                    name={cardResult.nftMetadata?.name}
                    attributes={cardResult.nftMetadata?.attributes}
                    insuredValueUsdc={cardResult.nftMetadata?.insuredValueUsdc}
                    rarity={cardResult.rarity}
                    className="sm:mt-2"
                  />
                </div>
              ) : (
                <GachaPack width={180} face="back" />
              )}
              {room.rarity && !show3D && (
                <span className={`text-sm font-semibold uppercase tracking-wide px-3 py-1 rounded-full border ${RARITY_STYLE[room.rarity] ?? RARITY_STYLE.common}`}>
                  {room.rarity}
                </span>
              )}
              {!show3D && <p className="text-slate-300 text-base font-medium">{statusCaption}</p>}
            </div>

            {room.status === "waiting" && !detail.myParticipant && (
              <button
                type="button"
                onClick={handleJoin}
                disabled={busy}
                className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
              >
                {busy ? "Joining…" : `Join for $${room.entryUsdc.toFixed(2)}`}
              </button>
            )}

            {showGachaDevTools && room.status === "waiting" && (
              <button
                type="button"
                onClick={handleFillWithBots}
                disabled={fillingBots}
                className="w-full h-10 mt-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 text-base font-medium hover:bg-emerald-500/15 transition-colors disabled:opacity-50"
              >
                {fillingBots ? "Filling…" : "Dev: fill remaining seats with bots"}
              </button>
            )}

            {showGachaDevTools && room.status === "excluding" && (
              <button
                type="button"
                onClick={handleForceSettle}
                disabled={forceSettling}
                className="w-full h-10 mt-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 text-base font-medium hover:bg-emerald-500/15 transition-colors disabled:opacity-50"
              >
                {forceSettling ? "Running…" : "Dev: force the exclusion draw now (skip cron wait)"}
              </button>
            )}

            {room.status === "excluding" && !lastExcluded && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-3">
                <p className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] text-white">The draw is running…</p>
                <p className="text-slate-400 text-base">
                  {room.exclusionCount} of {room.seats} {room.exclusionCount === 1 ? "player gets" : "players get"} excluded — survivors split the buyback.
                </p>
              </div>
            )}


            {showReadyGate && (
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 text-center space-y-3">
                <div className="absolute inset-x-0 top-0 h-1 bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] transition-[width] duration-1000 ease-linear"
                    style={{ width: `${(readyCountdown / READY_SECONDS) * 100}%` }}
                  />
                </div>
                {iAmReady ? (
                  <p className="text-slate-300 text-base">
                    Waiting for everyone to be ready — {lastReadyUpdate?.readyCount ?? 1}/{room.seatsFilled} ready. The reveal starts automatically once everyone is.
                  </p>
                ) : (
                  <>
                    <p className="text-slate-300 text-base">Everyone marks ready, then the pack opens for the whole room at once.</p>
                    <button
                      type="button"
                      onClick={handleMarkReady}
                      className="w-full h-11 rounded-full bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] text-white font-display font-semibold hover:opacity-90 transition-opacity"
                    >
                      I&apos;m ready ({readyCountdown}s)
                    </button>
                  </>
                )}
              </div>
            )}

            {room.status === "settled" && detail.myParticipant?.excluded && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center space-y-2">
                <p className="text-slate-100 text-lg font-bold">You were excluded this round</p>
                <p className="text-slate-400 text-base">No payout this time — the survivors split the buyback.</p>
                <Link
                  href="/app/gacha"
                  className="inline-block mt-2 w-full h-11 leading-[44px] rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
                >
                  Back to rooms
                </Link>
              </div>
            )}

            {room.status === "settled" && detail.myParticipant && !detail.myParticipant.excluded && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
                {detail.myParticipant.claimed ? (
                  <p className="text-center text-slate-100 text-lg font-bold">
                    Claimed{detail.myParticipant.payoutIsPrivate ? " privately" : ""} — ${detail.myParticipant.payoutUsdc?.toFixed(2)}
                  </p>
                ) : (
                  <>
                    <p className="text-center text-slate-100 text-lg font-bold">Your payout: ${detail.myParticipant.payoutUsdc?.toFixed(2)}</p>
                    <div>
                      <p className="text-slate-400 text-base mb-2">Claim</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setIsPrivate(true)}
                          className={`flex-1 h-10 rounded-xl border text-base font-medium transition-colors ${isPrivate ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"}`}
                        >
                          Private
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPrivate(false)}
                          className={`flex-1 h-10 rounded-xl border text-base font-medium transition-colors ${!isPrivate ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"}`}
                        >
                          Not private
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClaim}
                      disabled={busy}
                      className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
                    >
                      {busy ? "Claiming…" : `Claim $${detail.myParticipant.payoutUsdc?.toFixed(2)}`}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
