"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLooftaSigner } from "@/components/deposit/DepositSheet";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePoolRipSeat } from "@/hooks/usePoolRipSeat";

const MONO = "var(--font-home-mono), 'JetBrains Mono', monospace";
const LANE = "collab-25";
const AMOUNTS = [1, 2, 5];
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SHOWN = 4;

type Pool = { id: string; laneKey: string; status: string; targetUsdc: number; raisedUsdc: number; held?: { usdc: number }; card?: { name: string } | null };
type Person = { id: string; owner: string; name: string; avatarUrl: string | null; putUsdc: number };

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api/poolrip/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(path);
  return r.json() as Promise<T>;
}

function Avatar({ p }: { p: Person }) {
  const style: React.CSSProperties = { width: 26, height: 26, borderRadius: 999, border: "2px solid #1A1A20", marginLeft: -8, flex: "none", display: "grid", placeItems: "center", background: "#2A2A33", color: "#F2EFE8", fontWeight: 700, fontSize: 13 };
  return <span style={style}>{(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()}</span>;
}

/**
 * Home card for PoolRip's open collab pool: who is in, how full the $25 pack is, and one-tap +$1 / +$2 / +$5. Joining
 * uses the same Privy wallet and token as PoolRip itself (see usePoolRipSeat), so the money goes straight into the pool.
 */
export function PoolRipPoolCard({ balanceUsd, getAccessToken, solanaAddress }: { balanceUsd: number; getAccessToken: () => Promise<string | null>; solanaAddress: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { wallet } = useLooftaSigner(solanaAddress);
  const join = usePoolRipSeat(getAccessToken, "home_pool_card");
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("1");

  const pool = useQuery({
    queryKey: ["poolrip-collab-pool"],
    refetchInterval: 10_000,
    retry: 1,
    queryFn: async () => {
      const list = await getJson<Pool[]>("lobby");
      return list.find((p) => p.laneKey === LANE && p.status === "filling") ?? list.find((p) => p.laneKey === LANE) ?? null;
    },
  });
  const poolId = pool.data?.id;
  const people = useQuery({
    queryKey: ["poolrip-collab-people", poolId],
    enabled: !!poolId,
    refetchInterval: 10_000,
    retry: 1,
    queryFn: async () => (await getJson<{ participants: Person[] }>(`pools/${poolId}`)).participants,
  });

  if (pool.isError || (pool.isSuccess && !pool.data)) return null; // PoolRip unreachable or no open pool: show nothing rather than a broken card
  const target = pool.data?.targetUsdc ?? 25;
  const raised = Math.min(target, pool.data?.raisedUsdc ?? 0);
  const left = Math.max(0, target - raised - (pool.data?.held?.usdc ?? 0));
  const pct = Math.min(100, (raised / target) * 100);
  // one row per player (a player can hold several entries)
  const byOwner = new Map<string, Person>();
  for (const p of people.data ?? []) {
    const hit = byOwner.get(p.owner);
    byOwner.set(p.owner, hit ? { ...hit, putUsdc: hit.putUsdc + p.putUsdc } : p);
  }
  const players = [...byOwner.values()];

  const add = async (amount: number) => {
    if (busy !== null) return;
    setBusy(amount);
    const ok = await join(wallet, { lane: LANE, amountUsdc: amount });
    setBusy(null);
    if (ok) {
      setOpen(false);
      toast({ title: `${money(amount)} added to the pool`, description: "You own a share of the card, split when it is sold back." });
      void queryClient.invalidateQueries({ queryKey: ["poolrip-collab-pool"] });
      void queryClient.invalidateQueries({ queryKey: ["poolrip-collab-people"] });
      void queryClient.invalidateQueries({ queryKey: ["embeddedSolanaUsdcBalance"] });
    } else {
      toast({ variant: "destructive", title: "Could not add to the pool", description: "Nothing was charged. Try again in a moment." });
    }
  };

  const typed = Math.round(Number(amountText) * 100) / 100;
  const problem = !Number.isFinite(typed) || typed < 0.5 ? "Minimum is $0.50" : typed > balanceUsd ? "Not enough balance" : typed > left ? `Only ${money(left)} left in this pool` : null;
  const share = Number.isFinite(typed) && typed > 0 ? Math.min(100, (typed / target) * 100) : 0;
  const roomHref = poolId ? `https://play.loofta.com/pool/${poolId}?utm_source=loofta&utm_medium=app_home&utm_campaign=pool_card` : "https://play.loofta.com/";
  const chip = (active: boolean): React.CSSProperties => ({ cursor: "pointer", padding: "8px 14px", borderRadius: 12, fontWeight: 700, fontSize: 15, background: active ? "rgba(245,183,12,0.16)" : "#22222A", border: `1px solid ${active ? "rgba(245,183,12,0.6)" : "rgba(255,255,255,0.1)"}`, color: "#F2EFE8" });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/poolrip-icon.svg" alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain", flex: "none" }} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 0" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>Rip a pack together</span>
          <span style={{ fontSize: 13, color: "#9A98A3", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{money(raised)} / {money(target)}{players.length > 0 ? ` · ${players.length} in` : ""}</span>
        </div>
        <button type="button" onClick={() => setOpen(true)} style={{ flex: "none", cursor: "pointer", padding: "8px 16px", borderRadius: 12, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 800, fontSize: 14 }}>Chip in</button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (busy === null) setOpen(o); }}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-sm max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#121217] p-5 text-white sm:p-6">
          <DialogTitle className="text-2xl font-extrabold">Chip in to the $25 pack</DialogTitle>
          <DialogDescription className="text-base text-[#9A98A3]">Players pool money to rip a real graded Pokémon card. When the pool is full the pack opens live, the card is sold back and the money is split by share.</DialogDescription>

          <div style={{ position: "relative", height: 150, margin: "4px 0 2px" }} aria-hidden>
            {[["umbreon-vmax", -14, -64], ["charizard-holo", 0, 0], ["pikachu-svp", 14, 64]].map(([f, rot, x]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f as string} src={`/images/poolrip-cards/${f}.jpg`} alt="" style={{ position: "absolute", left: "50%", top: 0, height: 146, width: "auto", borderRadius: 10, transform: `translateX(calc(-50% + ${x}px)) rotate(${rot}deg)`, boxShadow: "0 10px 24px rgba(0,0,0,0.5)", zIndex: rot === 0 ? 2 : 1 }} />
            ))}
          </div>
          <p style={{ fontSize: 13, color: "#8A8893", textAlign: "center" }}>Example cards. The real pull is a surprise.</p>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: "1 1 0", height: 8, borderRadius: 999, background: "rgba(0,0,0,0.4)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(pct, raised > 0 ? 4 : 0)}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#FF4A26,#FF7A2A,#EAB308)" }} />
            </div>
            <span style={{ flex: "none", fontFamily: MONO, fontSize: 13, color: "#9A98A3", fontVariantNumeric: "tabular-nums" }}>{money(raised)} / {money(target)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", paddingLeft: 8, flex: "none" }}>{players.slice(0, SHOWN).map((p) => <Avatar key={p.owner} p={p} />)}</div>
            <span style={{ fontSize: 14, color: "#9A98A3" }}>{players.length === 0 ? "Be the first in" : `${players.length} ${players.length === 1 ? "player" : "players"} in`}{left > 0 ? `, ${money(left)} left` : ""}</span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {AMOUNTS.map((a) => <button key={a} type="button" disabled={busy !== null} onClick={() => setAmountText(String(a))} style={chip(typed === a)}>${a}</button>)}
            <span style={{ display: "flex", alignItems: "center", gap: 2, padding: "7px 12px", borderRadius: 12, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", fontWeight: 700, fontSize: 15 }}>
              $<input value={amountText} disabled={busy !== null} onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} inputMode="decimal" aria-label="Amount in dollars" style={{ width: 56, background: "none", border: 0, outline: 0, color: "inherit", font: "inherit", fontVariantNumeric: "tabular-nums" }} />
            </span>
          </div>

          <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.05)", fontSize: 15, lineHeight: 1.45 }}>
            You pay <b>{Number.isFinite(typed) ? money(typed) : "$0.00"}</b> from your Loofta balance and own about <b>{share.toFixed(share < 10 ? 1 : 0)}%</b> of the pool. Your share of the sale is paid to your balance. If the room fills first, the extra is refunded.
          </div>
          {problem && <p style={{ fontSize: 14, color: "#F87171" }}>{problem}</p>}

          <button type="button" disabled={!!problem || busy !== null || !wallet} onClick={() => { void add(typed); }} style={{ cursor: problem || busy !== null || !wallet ? "not-allowed" : "pointer", opacity: problem || busy !== null || !wallet ? 0.5 : 1, padding: "14px", borderRadius: 16, border: 0, background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontWeight: 800, fontSize: 16 }}>
            {busy !== null ? "Adding…" : `Confirm ${Number.isFinite(typed) ? money(typed) : ""}`}
          </button>
          <a href={roomHref} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center", color: "#9A98A3", fontWeight: 400, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 3 }}>Watch the pool on PoolRip</a>
        </DialogContent>
      </Dialog>
    </>
  );
}
