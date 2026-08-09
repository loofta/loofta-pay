"use client";

// Gacha "Rip Party" — pick your mascot, then pick a room size (which is when the actual
// join-tx/payment happens). Fully chromeless (see AppShell's isGachaRoomPage) — the explainer +
// Start button live at /app/gacha instead, which keeps the normal app header. See
// apps/backend/src/modules/gacha for the room lifecycle this leads into (waiting -> purchasing ->
// opening (rip) -> excluding (roulette) -> voting (cut one more?) -> settled).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ChevronLeft } from "lucide-react";
import MascotPicker from "@/components/MascotPicker";
import { Shell } from "@/components/PackParty";
import { getMascot } from "@/lib/mascots";

interface RoomConfig {
  configKey: string;
  packType: string;
  seats: number;
  entryUsdc: number;
  enabled: boolean;
  displayOrder: number;
}

function friendlyJoinError(rawMessage: string | undefined): string {
  const s = (rawMessage ?? "").toLowerCase();
  if (s.includes("insufficient funds")) return "Not enough USDC in your wallet for this room's entry.";
  if (s.includes("user rejected") || s.includes("denied")) return "Payment cancelled.";
  if (s.includes("filled up")) return "This room just filled up — try again to join another one.";
  return rawMessage && rawMessage.length < 200 ? rawMessage : "Couldn't join right now — please try again.";
}

type Stage = "pick" | "size";

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

  useEffect(() => {
    fetch("/api/gacha/configs").then((r) => (r.ok ? r.json() : [])).then(setConfigs).catch(() => {});
  }, []);

  const enabledConfigs = configs.filter((c) => c.enabled);
  const seatSizes = Array.from(new Set(enabledConfigs.map((c) => c.seats))).sort((a, b) => a - b);
  useEffect(() => {
    if (pickedSeats === null && seatSizes.length) setPickedSeats(seatSizes[0]);
  }, [pickedSeats, seatSizes]);
  const activeConfig = enabledConfigs.find((c) => c.seats === pickedSeats) ?? null;

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
              <button
                type="button"
                className="pp-btn gold"
                disabled={joiningSeats !== null}
                onClick={() => handleJoin(activeConfig.configKey, activeConfig.seats)}
              >
                {joiningSeats !== null ? "JOINING…" : `JOIN FOR $${activeConfig.entryUsdc.toFixed(2)} →`}
              </button>
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
              {Array.from({ length: activeConfig.seats }, (_, i) => (
                <div key={i} className="pp-slot">?</div>
              ))}
            </div>
          )}
        </Shell>
      )}
    </div>
  );
}
