"use client";

// Gacha room — the whole pooled-pack lifecycle on one page, screens ported 1:1 from
// pack-party/preview/pack-party-screens.jsx: LOBBY (waiting for seats, pay-to-join fills this
// same screen) -> RIP (ready check + 3D pack open) -> ROULETTE/OUUUT (VRF exclusion draw reveal,
// see GachaRoulette.tsx) -> VOTE (cut one more?) -> WINNERS (buyback split + claim). Backend
// contract: apps/backend/src/modules/gacha/{gacha.service,gacha.controller,gacha.gateway}.ts.
// Live updates come from useGachaRoomSocket (GachaGateway); every event just triggers a REST
// refetch rather than trying to hand-merge partial deltas into local state — events are
// infrequent (a handful over a room's whole lifetime), so simplicity wins over shaving a request.
//
// No click-to-open: every participant marks themselves ready (see the ready UI below), and once
// the backend sees everyone has, `room:all_ready` fires and the 3D rip plays automatically for
// everyone watching, in sync — nobody taps anything to start it. The old room-participants-only
// bid auction that used to follow the reveal is gone — replaced by a MagicBlock-VRF exclusion
// draw that runs right after the pack opens; the bid-auction backend code (gacha_bids,
// advanceToNextBidCandidate, etc.) still exists but is unreachable from this new flow — left
// dormant rather than deleted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import MascotPicker from "@/components/MascotPicker";
import GachaRoulette from "@/components/GachaRoulette";
import VoteRound from "@/components/VoteRound";
import Mascot from "@/components/Mascot";
import GachaCard from "@/components/GachaCard";
import CardAttributesPanel from "@/components/CardAttributesPanel";
import { Shell, Chip, money, GRAD_STYLE, type ChipPlayer } from "@/components/PackParty";
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
    voteRound: number | null;
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
  // Auto-claim (see below) always pays out publicly, straight to the wallet — the private/
  // shielded claim route goes through a MagicBlock ephemeral-rollup path that isn't fully wired
  // up yet (claimPayout's sendPrivatePayout can reject with "temporarily unavailable"), which
  // isn't a risk worth taking on an action that fires automatically with no user confirmation.
  const isPrivate = false;

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
  // Captured directly from GachaPack3D's onOpened callback — used for the pp-pull card summary
  // on the roulette screen regardless of whether this page's own polling has caught up yet.
  const [revealedCard, setRevealedCard] = useState<GachaOpenResult | null>(null);
  // A deliberate beat between the rip finishing and the exclusion roulette starting — big card,
  // real metadata, GachaCard's own click-to-zoom — dismissed with "WHO GETS TO EAT?" once the
  // room's actually looked at what they pulled. Only ever shown to someone who watched the rip
  // live (played3DReveal), same as the rip screen itself.
  const [cardRevealDismissed, setCardRevealDismissed] = useState(false);

  // Ready-to-open gate — see the file header comment. Marking ready is a one-way local action;
  // "all ready" is authoritative from the server (room:all_ready), never inferred client-side.
  const [iAmReady, setIAmReady] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const showGachaDevTools = process.env.NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS === "true";
  const [fillingBots, setFillingBots] = useState(false);
  const [forceSettling, setForceSettling] = useState(false);

  // Privy access tokens expire (short-lived JWTs) — fetching one once on mount and reusing that
  // same string for every 5s poll for a room's whole lifetime (which can run well past the
  // token's lifetime) meant every refresh silently started 401ing partway through a room, and
  // since a failed refresh just `return`ed, the page froze on stale data with zero indication
  // anything was wrong (looked exactly like a stuck room). getAccessToken() itself auto-refreshes
  // Privy's underlying token when called, so call it fresh every time instead of trusting the
  // `accessToken` state snapshot from mount (that state is still used for the initial websocket
  // handshake below, which is a separate, much shorter-lived concern than 5s-interval polling).
  const refresh = useCallback(async () => {
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    const res = await fetch(`/api/gacha/rooms/${roomId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { setError("Lost sync with the room — refresh the page if this doesn't clear up."); return; }
    const data: RoomDetail = await res.json();
    if (arrivedAlreadyRevealedRef.current === null) arrivedAlreadyRevealedRef.current = !!data.room.nftMetadata;
    setDetail(data);
    setError((e) => (e === "Lost sync with the room — refresh the page if this doesn't clear up." ? null : e));
  }, [roomId, getAccessToken]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const {
    lastUpdate, lastOpened, lastSettled, lastExcluded, lastReadyUpdate, allReadyTick, readySeats, markReady, lockMascot,
    lastVoteRoundStarted, lastVoteResult, lastVoteCut, castVote,
  } = useGachaRoomSocket(roomId, accessToken);
  useEffect(() => { refresh(); }, [lastUpdate, lastOpened, lastSettled, lastExcluded, lastVoteRoundStarted, lastVoteResult, lastVoteCut]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (allReadyTick > 0) setAutoOpen(true); }, [allReadyTick]);

  // Drives the full-screen ROULETTE/OUUUT takeover (GachaRoulette) — stays true for the whole
  // sequence regardless of what room.status has moved on to underneath by the time it finishes
  // (status flips to 'voting' server-side the moment the draw resolves, well before the reveal
  // animation is done playing). Never fires for someone who arrives after 'excluding' has already
  // passed — same "skip the replay" philosophy as arrivedAlreadyRevealedRef above.
  const [rouletteActive, setRouletteActive] = useState(false);
  useEffect(() => { if (detail?.room.status === "excluding") setRouletteActive(true); }, [detail?.room.status]);

  // Voting: myVote resets every time a new round starts; drawInProgress covers the window between
  // a round passing (see checkVoteRoundComplete) and either the next round starting or settling.
  const [myVote, setMyVote] = useState<boolean | undefined>(undefined);
  useEffect(() => { setMyVote(undefined); }, [lastVoteRoundStarted?.round]);
  const [voteDrawInProgress, setVoteDrawInProgress] = useState(false);
  useEffect(() => { if (lastVoteResult?.passed) setVoteDrawInProgress(true); }, [lastVoteResult]);
  useEffect(() => { setVoteDrawInProgress(false); }, [lastVoteRoundStarted?.round]);
  const handleVote = useCallback(async (vote: boolean) => {
    const res = await castVote(vote);
    if (res.ok) { setMyVote(vote); refresh(); } else setError(res.error ?? "Couldn't cast your vote — please try again.");
  }, [castVote, refresh]);

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

      // This page's own join button fires either as a first-time join for someone who landed on
      // a room link directly (no pre-chosen mascot — falls back to a random one, same as
      // MascotPicker's own stall timeout) or as "Run it back" replaying with the same mascot.
      const joinRes = await fetch(`/api/gacha/rooms/${targetRoomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ paymentTxHash, mascotKey: detail?.myParticipant?.mascotKey }),
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
      // trip — the button naturally disappears once room.status leaves "waiting", so this only
      // needs to stay true through a successful call — only reset it on failure.
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

  const handleForceVote = useCallback(async () => {
    setForceSettling(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/gacha/rooms/${roomId}/force-vote`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Failed to force the vote round");
      refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Failed to force the vote round.");
    } finally {
      setForceSettling(false);
    }
  }, [roomId, getAccessToken, refresh]);

  // Demo mode: rooms auto-fill with bots the instant you join a waiting one — no manual "fill"
  // button. Fires once per room (autoFilledRef), only when dev tools are on (devnet only anyway).
  const autoFilledRef = useRef(false);
  useEffect(() => {
    if (!showGachaDevTools || autoFilledRef.current) return;
    if (room?.status !== "waiting" || !detail?.myParticipant) return;
    autoFilledRef.current = true;
    handleFillWithBots();
  }, [showGachaDevTools, room?.status, detail?.myParticipant, handleFillWithBots]);

  const handleMarkReady = useCallback(() => {
    setIAmReady(true);
    markReady();
  }, [markReady]);

  // Same "don't let one distracted player stall the room" pattern as MascotPicker's own 30s
  // timer — the ready-gate used to wait indefinitely for a manual click with no fallback.
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

  // Auto-claim — the WINNERS screen just shows the split and RUN IT BACK / LEAVE, no manual
  // private/public choice or claim button (see isPrivate above for why it's always public).
  const autoClaimedRef = useRef(false);
  useEffect(() => {
    if (autoClaimedRef.current) return;
    if (detail?.room.status !== "settled" || !detail.myParticipant || detail.myParticipant.excluded || detail.myParticipant.claimed) return;
    autoClaimedRef.current = true;
    handleClaim();
  }, [detail?.room.status, detail?.myParticipant, handleClaim]);

  const statusCaption = useMemo(() => {
    if (!room) return "";
    switch (room.status) {
      case "waiting": return room.seatsFilled >= room.seats ? "room is full. no backing out now." : "degens joining…";
      case "excluding": return "running the exclusion draw…";
      case "voting": return `vote round ${room.voteRound ?? 1} — cut one more?`;
      case "purchasing": return "buying the pack…";
      case "opening": return "opening the pack…";
      case "settling": return "settling up…";
      case "settled": return "settled";
      case "cancelled": return "cancelled";
      case "failed": return "something went wrong with this room — contact support";
      default: return room.status;
    }
  }, [room]);

  if (!detail || !room) {
    return <div className="min-h-screen bg-[#0B0B0F] text-slate-100 flex items-center justify-center text-base font-display">Loading room…</div>;
  }

  // See the refs/state above: the 3D rip experience only ever plays once, for whoever is
  // actually watching live — everyone else (already-revealed on first load, or already watched
  // it once this session) gets the flat settled view straight away.
  const show3D = !arrivedAlreadyRevealedRef.current && !played3DReveal && room.status !== "failed" && room.status !== "cancelled";
  const cardResult: GachaOpenResult | null = revealedCard ?? (room.nftMetadata ? { nftMetadata: room.nftMetadata, rarity: (room.rarity ?? "common") as GachaRarity } : null);
  const showReadyGate = show3D && !!room.nftMetadata && !!detail.myParticipant && !autoOpen;
  // Mascot lock-in is its own isolated screen — see the file header. Mascot is now picked BEFORE
  // joining (see /app/gacha/play), so this is dormant except for legacy/edge-case seats.
  const isPicking = room.status === "waiting" && !!detail.myParticipant && !detail.myParticipant.mascotLocked;
  const myMascot = getMascot(detail.myParticipant?.mascotKey);

  const toChipPlayer = (p: RoomDetail["participants"][number]): ChipPlayer => ({
    seatNumber: p.seatNumber,
    mascotKey: p.mascotKey,
    name: getMascot(p.mascotKey)?.name ?? p.username ?? `Seat ${p.seatNumber}`,
    isMe: p.isMe,
    excluded: p.excluded,
  });

  // Only trust the participants' `excluded` flags as the initial draw's victim list once we know
  // no vote-cut round has run yet (exact count match) — otherwise a late-arriving viewer who
  // missed the socket event could see a vote-cut victim folded into the roulette reveal, which
  // never actually happened on the roulette screen. lastExcluded (the real-time event) is always
  // preferred when available.
  const excludedNow = detail.participants.filter((p) => p.excluded).map((p) => p.seatNumber);
  const initialExcludedFallback = excludedNow.length === room.exclusionCount ? excludedNow : null;
  const finalVictims = lastExcluded?.excludedSeatNumbers ?? (room.status !== "excluding" ? initialExcludedFallback : null);

  const survivors = detail.participants.filter((p) => !p.excluded);
  const survivorShare = survivors.length && room.buybackAmountUsdc !== null ? room.buybackAmountUsdc / survivors.length : 0;

  const devTools = showGachaDevTools && (
    <div className="absolute right-4 bottom-4 z-20 flex flex-col gap-2 items-end">
      {room.status === "excluding" && (
        <button type="button" onClick={handleForceSettle} disabled={forceSettling} className="pp-seg" style={{ borderColor: "#34D399", color: "#34D399" }}>
          {forceSettling ? "Running…" : "Cheat: force exclusion draw"}
        </button>
      )}
      {room.status === "voting" && (
        <button type="button" onClick={handleForceVote} disabled={forceSettling} className="pp-seg" style={{ borderColor: "#34D399", color: "#34D399" }}>
          {forceSettling ? "Running…" : "Cheat: force this vote round"}
        </button>
      )}
    </div>
  );

  const chrome = (
    <>
      <Link href="/app/gacha" className="absolute left-4 top-4 z-20 flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm">
        <ChevronLeft className="w-4 h-4" /> Rooms
      </Link>
      {error && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 w-full max-w-md px-5">
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>
        </div>
      )}
      {devTools}
    </>
  );

  // The RIP screen (ready gate + 3D pack open) must stay up until the animation itself finishes
  // playing, even though room.status typically flips to 'excluding' on the server the moment
  // nftMetadata lands — well before the client has actually watched the rip. Without this, the
  // roulette screen would yank in mid-animation for anyone actually watching live.
  const showRipScreen = show3D && !played3DReveal && (room.status === "purchasing" || room.status === "opening" || room.status === "excluding");

  let screen: React.ReactNode;

  if (isPicking) {
    screen = <MascotPicker lockedMascotKey={null} onLock={handleLockMascot} />;
  } else if (showRipScreen) {
    screen = (
      <div className="pp-shell pp-rip">
        <div className="pp-glow" />
        <div className="pp-ripbar">
          <span aria-hidden style={{ width: 1 }} />
          <div className="pp-ripchips">
            {detail.participants.map((p) => {
              const m = getMascot(p.mascotKey);
              const isReady = readySeats.includes(p.seatNumber);
              return (
                <div key={p.seatNumber} className={"pp-minichip" + (isReady ? " rdy" : "")}>
                  {m && <Mascot name={m.key} mood={isReady ? "happy" : "idle"} size={40} title={m.name} />}
                </div>
              );
            })}
          </div>
          <span className="pp-kicker">3 / 7 · {statusCaption}</span>
        </div>
        <div className="absolute inset-0">
          <GachaPack3D
            autoOpen={autoOpen}
            resolveOpen={waitForReveal}
            onOpened={(result) => { setRevealedCard(result); setPlayed3DReveal(true); }}
            onError={(err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open the pack right now.")}
            idleSubtitle={autoOpen ? statusCaption : "waiting for everyone to be ready…"}
            openingLabel={statusCaption}
            // Default 22px lands right under pp-ripbar's own top-of-screen participant chip row
            // (~72px tall) and overlaps it — push the hint below that instead.
            hintTop={84}
          />
        </div>
        <div className="pp-ripfoot">
          {showReadyGate && !iAmReady && (
            <button type="button" className="pp-btn gold" onClick={handleMarkReady}>
              I&apos;M READY 🔥 ({readyCountdown}s)
            </button>
          )}
          {showReadyGate && iAmReady && (
            <span className="pp-small waitpulse">waiting — {lastReadyUpdate?.readyCount ?? 1}/{room.seatsFilled} ready</span>
          )}
          {!showReadyGate && !autoOpen && <span className="pp-small waitpulse">waiting on the room…</span>}
          {autoOpen && !played3DReveal && <span className="pp-small waitpulse">pack is ripping itself…</span>}
        </div>
      </div>
    );
  } else if (played3DReveal && !cardRevealDismissed && cardResult) {
    screen = (
      <Shell
        kicker="3 / 7 · RIPPED"
        title={cardResult.nftMetadata?.name ?? "YOU GOT"}
        sub={(cardResult.rarity ?? "common").toUpperCase()}
        footer={
          <button type="button" className="pp-btn" onClick={() => setCardRevealDismissed(true)}>
            WHO GETS TO EAT? →
          </button>
        }
      >
        <p className="font-display text-lg sm:text-xl font-semibold tracking-[0.04em] uppercase mb-4" style={{ marginTop: 0 }}>
          Buyback <span style={GRAD_STYLE}>{money(room.buybackAmountUsdc ?? 0)}</span>
        </p>
        <div className="w-full flex flex-col sm:flex-row items-center sm:items-start justify-center gap-6">
          {/* Popping out of the pack that just burst behind it, not a flat cut to a new screen —
              starts small/low/rotated (where the pack was) and springs up into place. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.35, y: 60, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.1 }}
          >
            <GachaCard
              width={200}
              card={{
                name: cardResult.nftMetadata?.name ?? "Mystery Card",
                rarity: cardResult.rarity,
                faceImage: cardResult.nftMetadata?.image,
                backImage: cardResult.nftMetadata?.backImage,
              }}
            />
          </motion.div>
          <CardAttributesPanel
            name={cardResult.nftMetadata?.name}
            attributes={cardResult.nftMetadata?.attributes}
            insuredValueUsdc={cardResult.nftMetadata?.insuredValueUsdc}
            rarity={cardResult.rarity}
            className="sm:mt-2"
          />
        </div>
      </Shell>
    );
  } else if (rouletteActive) {
    screen = (
      <GachaRoulette
        players={detail.participants.map(toChipPlayer)}
        cardName={cardResult?.nftMetadata?.name}
        cardImage={cardResult?.nftMetadata?.image}
        rarity={cardResult?.rarity ?? room.rarity}
        potUsdc={room.buybackAmountUsdc ?? 0}
        exclusionCount={room.exclusionCount}
        finalVictims={finalVictims}
        onContinue={() => setRouletteActive(false)}
      />
    );
  } else if (room.status === "waiting") {
    const full = room.seatsFilled >= room.seats;
    screen = (
      <Shell
        kicker="2 / 7 · LOBBY"
        title="THE"
        titleGrad="ROOM"
        sub={statusCaption}
        footer={
          !detail.myParticipant ? (
            <Link href="/app/gacha" className="pp-btn gold">
              JOIN FOR ${room.entryUsdc.toFixed(2)} →
            </Link>
          ) : (
            <button type="button" className={"pp-btn gold" + (full ? " waitpulse" : "")} disabled>
              {full ? "RIP THE PACK →" : `waiting ${room.seatsFilled}/${room.seats}`}
            </button>
          )
        }
      >
        <div className="pp-sizetoggle">
          {[room.seats].map((s) => (
            <button key={s} type="button" className="pp-seg on" disabled>
              {s} players
            </button>
          ))}
        </div>
        <div className="pp-lobbygrid">
          {Array.from({ length: room.seats }, (_, i) => {
            const p = detail.participants.find((pp) => pp.seatNumber === i + 1);
            return p ? <Chip key={p.seatNumber} p={toChipPlayer(p)} mood={p.isMe ? "happy" : "idle"} /> : <div key={`slot${i}`} className="pp-slot">?</div>;
          })}
        </div>
      </Shell>
    );
  } else if (room.status === "purchasing" || room.status === "opening") {
    // Not yet eligible for the full RIP screen (no nftMetadata to rip open yet, or already
    // arrived post-reveal — see showRipScreen above) — a minimal buying/opening holding screen.
    screen = <Shell kicker="3 / 7 · RIP" title="LOOFTA" titleGrad="RIP PARTY" sub={statusCaption} />;
  } else if (room.status === "voting") {
    screen = (
      <VoteRound
        round={room.voteRound ?? 1}
        survivors={detail.participants.filter((p) => !p.excluded)}
        potUsdc={room.buybackAmountUsdc ?? 0}
        myVote={myVote}
        onVote={handleVote}
        drawInProgress={voteDrawInProgress}
      />
    );
  } else if (room.status === "settled" || room.status === "settling") {
    // 'settling' is a brief server-side lock (settlement in flight) before 'settled' — shown as
    // the same WINNERS screen rather than a separate "please wait" panel, since the split is
    // already known (buybackAmountUsdc was set earlier, at pack purchase) — only the per-user
    // claim (auto-fired once status is actually 'settled', see the effect above) waits on it.
    screen = (
      <Shell
        kicker="7 / 7 · PAYOUT"
        title="WINNERS"
        titleGrad="EAT"
        sub="buyback settled. instantly. obviously."
        footer={
          <div className="pp-votebtns">
            <button type="button" className="pp-btn gold" disabled={busy} onClick={handleJoin}>
              {busy ? "JOINING…" : "RUN IT BACK →"}
            </button>
            <Link href="/app/gacha" className="pp-btn ghost">
              LEAVE
            </Link>
          </div>
        }
      >
        {detail.myParticipant?.excluded && (
          <div className="flex flex-col items-center gap-2 mb-6">
            {myMascot && <Mascot name={myMascot.key} mood="sad" size={100} />}
            <p className="pp-small" style={{ marginTop: 0 }}>you were excluded this round — no payout</p>
          </div>
        )}
        <div className="pp-winrow">
          {survivors.map((p) => (
            <div key={p.seatNumber} className="pp-winner">
              <Chip p={toChipPlayer(p)} mood={p.isMe ? "winning" : "idle"} size={96} />
              <div className="pp-payout">+{money(survivorShare)}</div>
            </div>
          ))}
        </div>
        <div className="pp-pot">
          POT {money(room.buybackAmountUsdc ?? 0)} · SPLIT {survivors.length} WAYS
        </div>
      </Shell>
    );
  } else {
    screen = (
      <Shell title={room.status.toUpperCase()} sub={statusCaption} />
    );
  }

  return (
    <div className="relative min-h-screen">
      {chrome}
      {screen}
    </div>
  );
}
