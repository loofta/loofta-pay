"use client";

// Gacha Pooled Packs — room picker. Real Pokemon packs (Collectorcrypt), bought and opened as a
// pooled group event: pick a room size, pay your entry share, wait for the room to fill, then
// everyone watches the same pack open together. See apps/backend/src/modules/gacha for the
// lifecycle this drives (join -> purchase/open -> bid -> settle -> claim).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { X } from "lucide-react";
import GachaPack from "@/components/GachaPack";

interface RoomConfig {
  configKey: string;
  packType: string;
  seats: number;
  entryUsdc: number;
  enabled: boolean;
  displayOrder: number;
}

interface RoomSummary {
  id: string;
  configKey: string;
  status: string;
  seats: number;
  seatsFilled: number;
  entryUsdc: number;
}

function friendlyJoinError(rawMessage: string | undefined): string {
  const s = (rawMessage ?? "").toLowerCase();
  if (s.includes("insufficient funds")) return "Not enough USDC in your wallet for this room's entry.";
  if (s.includes("user rejected") || s.includes("denied")) return "Payment cancelled.";
  if (s.includes("filled up")) return "This room just filled up — try again to join another one.";
  return rawMessage && rawMessage.length < 200 ? rawMessage : "Couldn't join right now — please try again.";
}

export default function GachaLobbyPage() {
  const router = useRouter();
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find((w) => w.address === embeddedSolAddress) ?? wallets[0];

  const [configs, setConfigs] = useState<RoomConfig[] | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [configsRes, roomsRes] = await Promise.all([fetch("/api/gacha/configs"), fetch("/api/gacha/rooms")]);
    if (configsRes.ok) setConfigs(await configsRes.json());
    if (roomsRes.ok) setRooms(await roomsRes.json());
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleJoin = useCallback(
    async (configKey: string) => {
      if (!authenticated) { login(); return; }
      if (!embeddedWallet?.address) { setError("No Solana wallet found"); return; }
      setJoiningKey(configKey);
      setError(null);
      try {
        const token = await getAccessToken();
        const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        const joinTxRes = await fetch("/api/gacha/rooms/join-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ configKey, userSolanaAddress: embeddedWallet.address }),
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
          body: JSON.stringify({ paymentTxHash }),
        });
        if (!joinRes.ok) throw new Error((await joinRes.json().catch(() => null))?.message ?? "Failed to join room");

        router.push(`/app/gacha/${roomId}`);
      } catch (err: any) {
        setError(friendlyJoinError(err?.message));
      } finally {
        setJoiningKey(null);
      }
    },
    [authenticated, login, embeddedWallet, getAccessToken, signAndSendTransaction, router],
  );

  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      <div className="max-w-3xl mx-auto px-5 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Gacha Packs</h1>
            <p className="text-slate-400 text-base mt-1">Pool up, open a real Pokemon pack together, split the payout.</p>
          </div>
          <Link href="/app" className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
            <span className="sr-only">Exit</span>
          </Link>
        </div>

        <Link
          href="/app/gacha/demo"
          className="flex items-center justify-center w-full h-11 rounded-full border border-white/10 bg-white/5 text-slate-300 font-medium hover:bg-white/10 hover:text-white transition-colors mb-8"
        >
          Try the demo — no money, no backend
        </Link>

        {error && (
          <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-base text-red-300">{error}</div>
        )}

        <div className="grid sm:grid-cols-2 gap-5 mb-10">
          {(configs ?? []).map((cfg) => (
            <div key={cfg.configKey} className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col items-center gap-4">
              <GachaPack width={160} />
              <div className="text-center">
                <p className="text-lg font-bold text-slate-100">{cfg.seats} players · ${cfg.entryUsdc.toFixed(2)} each</p>
                <p className="text-slate-400 text-base mt-1">${(cfg.seats * cfg.entryUsdc).toFixed(0)} pool total</p>
              </div>
              <button
                type="button"
                onClick={() => handleJoin(cfg.configKey)}
                disabled={joiningKey !== null}
                className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
              >
                {joiningKey === cfg.configKey ? "Joining…" : `Join for $${cfg.entryUsdc.toFixed(2)}`}
              </button>
            </div>
          ))}
        </div>

        {rooms.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Open rooms</p>
            <div className="space-y-2">
              {rooms.map((room) => (
                <Link
                  key={room.id}
                  href={`/app/gacha/${room.id}`}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/[0.08] transition-colors"
                >
                  <span className="text-slate-200 text-base font-medium">{room.seatsFilled}/{room.seats} players</span>
                  <span className="text-slate-400 text-base capitalize">{room.status}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
