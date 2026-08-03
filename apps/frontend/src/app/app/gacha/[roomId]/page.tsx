"use client";

// Gacha room — the whole pooled-pack lifecycle on one page: lobby (waiting for seats) -> pack
// purchase/open -> ready check -> 3D rip -> room-participants-only bidding -> settlement ->
// claim (public or private). Backend contract:
// apps/backend/src/modules/gacha/{gacha.service,gacha.controller,gacha.gateway}.ts.
// Live updates come from useGachaRoomSocket (GachaGateway); every event just triggers a REST
// refetch rather than trying to hand-merge partial deltas into local state — events are
// infrequent (a handful over a room's whole lifetime), so simplicity wins over shaving a request.
//
// No click-to-open: every participant marks themselves ready (see the ready UI below), and once
// the backend sees everyone has, `room:all_ready` fires and the 3D rip plays automatically for
// everyone watching, in sync — nobody taps anything to start it.

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
import PokerTable, { AVATAR_EMOJIS } from "@/components/PokerTable";
import type { GachaOpenResult, GachaRarity } from "@/components/GachaPack3D";
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
    status: string;
    seatsFilled: number;
    nftMetadata: { image?: string; name?: string } | null;
    rarity: string | null;
    buybackAmountUsdc: number | null;
    bidWindowEndsAt: string | null;
    createdAt: string;
  };
  myParticipant: { seatNumber: number; payoutUsdc: number | null; payoutIsPrivate: boolean | null; claimed: boolean } | null;
  bestBid: { amountUsdc: number } | null;
  pendingBid: { bidId: string; userId: string; amountUsdc: number; deadline: string } | null;
  participants: Array<{ seatNumber: number; username: string | null; isMe: boolean }>;
}

const RARITY_STYLE: Record<string, string> = {
  common: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  uncommon: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rare: "border-purple-400/30 bg-purple-400/10 text-purple-300",
  epic: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

function useCountdown(deadline: string | null): number {
  const [msLeft, setMsLeft] = useState(0);
  useEffect(() => {
    if (!deadline) { setMsLeft(0); return; }
    const tick = () => setMsLeft(Math.max(0, new Date(deadline).getTime() - Date.now()));
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [deadline]);
  return msLeft;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
  const [bidInput, setBidInput] = useState("");
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

  const { lastUpdate, lastOpened, lastBid, lastSettled, lastReadyUpdate, allReadyTick, emojiBySeat, markReady, pickEmoji } = useGachaRoomSocket(roomId, accessToken);
  useEffect(() => { refresh(); }, [lastUpdate, lastOpened, lastBid, lastSettled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (allReadyTick > 0) setAutoOpen(true); }, [allReadyTick]);

  const bidDeadlineMs = useCountdown(detail?.room.status === "bidding" ? detail.room.bidWindowEndsAt : null);
  const payDeadlineMs = useCountdown(detail?.pendingBid?.deadline ?? null);

  const room = detail?.room;
  const isWinningBidder = !!detail?.pendingBid && detail.pendingBid.userId === user?.id;

  // GachaPack3D's resolveOpen contract: unlike Mystery Pack, the pack doesn't START a purchase
  // when the reveal triggers (the room already bought and is opening the pack automatically the
  // moment it filled) — it just waits for that already-in-flight process to finish, polling the
  // same `detail` state this page's own 5s interval + websocket-triggered refreshes keep current.
  const waitForReveal = useCallback((): Promise<GachaOpenResult> => {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 90_000; // generous — matches the backend's own ~60s openPack poll ceiling plus buffer
      const check = () => {
        const nft = detailRef.current?.room.nftMetadata;
        const rarity = detailRef.current?.room.rarity;
        if (nft && rarity) { resolve({ nftMetadata: nft, rarity: rarity as GachaRarity }); return; }
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
      const { txBase64, roomId: targetRoomId } = await joinTxRes.json();

      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({ transaction: txBytes as unknown as Uint8Array, wallet: embeddedWallet as any });
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

  const handleMarkReady = useCallback(() => {
    setIAmReady(true);
    markReady();
  }, [markReady]);

  const handleBid = useCallback(async () => {
    const amount = parseFloat(bidInput);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a valid bid amount"); return; }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/gacha/rooms/${roomId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ amountUsdc: amount }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Bid failed");
      setBidInput("");
      refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Bid failed — please try again.");
    } finally {
      setBusy(false);
    }
  }, [bidInput, roomId, getAccessToken, refresh]);

  const handlePayBid = useCallback(async () => {
    if (!embeddedWallet?.address) { setError("No Solana wallet found"); return; }
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const payTxRes = await fetch(`/api/gacha/rooms/${roomId}/pay-bid-tx`, { method: "POST", headers: authHeader });
      if (!payTxRes.ok) throw new Error((await payTxRes.json().catch(() => null))?.message ?? "Failed to prepare payment");
      const { txBase64 } = await payTxRes.json();

      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({ transaction: txBytes as unknown as Uint8Array, wallet: embeddedWallet as any });
      const paymentTxHash = bs58.encode(sigBytes as Uint8Array);

      const res = await fetch(`/api/gacha/rooms/${roomId}/pay-bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ paymentTxHash }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Payment failed");
      refresh();
    } catch (err: any) {
      setError(err?.message?.length < 200 ? err.message : "Payment failed — please try again.");
    } finally {
      setBusy(false);
    }
  }, [embeddedWallet, roomId, getAccessToken, signAndSendTransaction, refresh]);

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
  const show3D = !arrivedAlreadyRevealedRef.current && !played3DReveal;
  const cardResult: GachaOpenResult | null = revealedCard ?? (room.nftMetadata ? { nftMetadata: room.nftMetadata, rarity: (room.rarity ?? "common") as GachaRarity } : null);
  const showReadyGate = show3D && room.status !== "waiting" && !!detail.myParticipant && !autoOpen;

  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <Link href="/app/gacha" className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-base">
            <ChevronLeft className="w-4 h-4" /> Rooms
          </Link>
          <span className="text-slate-400 text-base">{room.seatsFilled}/{room.seats} players · ${room.entryUsdc.toFixed(2)} each</span>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>}

        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-full -mb-4 relative z-10">
            <PokerTable
              seats={room.seats}
              participants={detail.participants.map((p) => ({ ...p, emoji: emojiBySeat[p.seatNumber] }))}
            />
          </div>

          {detail.myParticipant && room.status !== "settled" && (
            <div className="flex flex-wrap justify-center gap-1.5 max-w-xs">
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => pickEmoji(e)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-colors ${emojiBySeat[detail.myParticipant!.seatNumber] === e ? "bg-amber-500/30 ring-2 ring-amber-400" : "bg-white/5 hover:bg-white/10"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {show3D ? (
            room.status === "waiting" ? (
              <GachaPack width={180} />
            ) : (
              <div className="w-full h-[380px] rounded-2xl overflow-hidden border border-white/10">
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
            <GachaCard
              width={220}
              card={{
                name: cardResult.nftMetadata?.name ?? "Mystery Card",
                rarity: cardResult.rarity,
                image: cardResult.nftMetadata?.image,
              }}
            />
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

        {showReadyGate && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center space-y-3">
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
                  className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
                >
                  I&apos;m ready
                </button>
              </>
            )}
          </div>
        )}

        {room.status === "bidding" && detail.myParticipant && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-base">Current best</p>
                <p className="text-2xl font-bold text-slate-100">${(detail.bestBid?.amountUsdc ?? room.buybackAmountUsdc ?? 0).toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400 text-base">Time left</p>
                <p className="text-2xl font-bold text-slate-100 tabular-nums">{formatCountdown(bidDeadlineMs)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={bidInput}
                onChange={(e) => setBidInput(e.target.value)}
                placeholder={`> $${(detail.bestBid?.amountUsdc ?? room.buybackAmountUsdc ?? 0).toFixed(2)}`}
                className="flex-1 h-11 rounded-full bg-white/10 border border-white/10 px-4 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400/50"
              />
              <button
                type="button"
                onClick={handleBid}
                disabled={busy || bidDeadlineMs <= 0}
                className="h-11 px-6 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
              >
                Bid
              </button>
            </div>
            <p className="text-slate-500 text-base">No bid? The card auto-sells back and everyone splits the buyback evenly.</p>
          </div>
        )}

        {room.status === "settling" && detail.pendingBid && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3 text-center">
            {isWinningBidder ? (
              <>
                <p className="text-slate-100 text-lg font-bold">You won the bid — ${detail.pendingBid.amountUsdc.toFixed(2)}</p>
                <p className="text-slate-400 text-base">Pay within {formatCountdown(payDeadlineMs)} to claim the card.</p>
                <button
                  type="button"
                  onClick={handlePayBid}
                  disabled={busy || payDeadlineMs <= 0}
                  className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
                >
                  {busy ? "Confirming…" : `Pay $${detail.pendingBid.amountUsdc.toFixed(2)}`}
                </button>
              </>
            ) : (
              <p className="text-slate-300 text-base">Waiting on the winning bidder to pay ({formatCountdown(payDeadlineMs)} left) — falls back automatically if they don&apos;t.</p>
            )}
          </div>
        )}

        {room.status === "settled" && detail.myParticipant && (
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
      </div>
    </div>
  );
}
