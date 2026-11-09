"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import bs58 from "bs58";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignMessage, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import { sora, manrope } from "@/components/home-v4/fonts";
import {
  ampleBuildClaim,
  ampleBuildDeposit,
  ampleBuildWithdraw,
  ampleChallenge,
  ampleLink,
  ampleTxStatus,
  getAmpleOverview,
  getAmpleStatus,
  type AmpleOverview,
  type AmpleSolanaTx,
  type AmpleStatus,
} from "@/services/api/ample";

const GOLD = "#F5B70C";
const card = { padding: 24, borderRadius: 26, background: "#16161A", border: "1px solid rgba(255,255,255,0.07)" } as const;
const btn = (disabled?: boolean) => ({
  width: "100%", padding: "14px 0", borderRadius: 16, border: "none", fontWeight: 700, fontSize: 16,
  background: disabled ? "#3A3520" : GOLD, color: disabled ? "#8A8264" : "#2A1A00", cursor: disabled ? "default" : "pointer",
}) as const;

/** Base units string -> display number string. Uses string math so large balances never lose precision. */
function fromBase(raw: string | number | undefined | null, decimals: number): string {
  if (raw === undefined || raw === null || raw === "") return "0";
  const s = String(raw).replace(/\D/g, "").padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

function toBase(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const out = (w + f.padEnd(decimals, "0")).replace(/^0+/, "");
  return out === "" ? null : out;
}

export function StakeToWin() {
  const { authenticated, userId, login, getAccessToken } = useAuth();
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [status, setStatus] = useState<AmpleStatus | null>(null);
  const [overview, setOverview] = useState<AmpleOverview | null>(null);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const solAddress = useMemo(() => {
    const acc = (user?.linkedAccounts ?? []).find(
      (a: any) => a.type === "wallet" && a.chainType === "solana" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2"),
    ) as any;
    return (acc?.address as string | undefined) ?? "";
  }, [user]);
  const wallet = wallets.find((w) => w.address === solAddress) ?? wallets[0];

  const opts = useCallback(async () => ({ userId: userId ?? undefined, accessToken: await getAccessToken().catch(() => null) }), [userId, getAccessToken]);

  const vault = status?.vaults?.[0];
  const decimals = vault?.token?.decimals ?? 6;
  const symbol = vault?.token?.symbol ?? "USDC";
  const held = overview?.balances.find((b) => !vault || !b.vaultId || b.vaultId === vault.id);

  const refresh = useCallback(async () => {
    try {
      const o = await opts();
      const s = await getAmpleStatus(o);
      setStatus(s);
      if (s.enabled && s.linked) setOverview(await getAmpleOverview(o));
    } catch (e: any) {
      setError(e?.message || "Could not load staking");
    } finally {
      setLoading(false);
    }
  }, [opts]);

  useEffect(() => {
    if (authenticated) void refresh();
    else setLoading(false);
  }, [authenticated, refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null); setNote(null);
    try { await fn(); }
    catch (e: any) {
      const m = String(e?.message ?? "");
      if (/reject|denied|cancel/i.test(m)) setError("Cancelled.");
      else if (/simulation/i.test(m)) setError("That transaction would fail, check your balance and try again.");
      else if (/exceeds/i.test(m)) setError("That is more than you have staked.");
      else setError(m || "Something went wrong, try again.");
    } finally { setBusy(null); }
  };

  const enable = () => run("link", async () => {
    if (!wallet || !solAddress) throw new Error("No Solana wallet found");
    const o = await opts();
    const ch = await ampleChallenge(solAddress, o);
    const { signature } = await signMessage({ message: new TextEncoder().encode(ch.message), wallet });
    await ampleLink({ walletAddress: solAddress, message: ch.message, signature: bs58.encode(signature as Uint8Array) }, o);
    await refresh();
  });

  const sendTx = async (tx: AmpleSolanaTx) => {
    if (!wallet) throw new Error("No Solana wallet found");
    if (tx.expiresAt && Date.now() > new Date(tx.expiresAt).getTime()) throw new Error("That quote expired, try again.");
    const bytes = Uint8Array.from(atob(tx.transaction.unsigned), (c) => c.charCodeAt(0));
    const { signature } = await signAndSendTransaction({ transaction: bytes, wallet });
    const sig = bs58.encode(signature as Uint8Array);
    const o = await opts();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await ampleTxStatus(sig, o).catch(() => null);
      if (st?.status === "SUCCESS") return;
      if (st?.status === "FAILED") throw new Error("The transaction did not land. Nothing was taken.");
    }
  };

  const stake = () => run("stake", async () => {
    const base = toBase(amount, decimals);
    if (!base || !vault) throw new Error("Enter an amount");
    await sendTx(await ampleBuildDeposit(vault.id, base, await opts()));
    setNote("Staked. You are in the next draw.");
    await refresh();
  });

  const unstakeAll = () => run("unstake", async () => {
    if (!vault || !held) return;
    await sendTx(await ampleBuildWithdraw(vault.id, String(held.depositsToken), await opts()));
    setNote("Withdrawn to your wallet.");
    await refresh();
  });

  const claim = (payoutId: string) => run("claim", async () => {
    await sendTx(await ampleBuildClaim(payoutId, await opts()));
    setNote("Reward added to your stake.");
    await refresh();
  });

  const t = overview?.tickets;
  const heldDisplay = fromBase(held?.depositsToken, held?.token?.decimals ?? decimals);

  return (
    <div className={`${sora.variable} ${manrope.variable}`} style={{ minHeight: "calc(100vh - var(--header-h, 0px))", background: "#0f0f12", color: "#F2EFE8", fontFamily: "var(--font-home-manrope), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px 80px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Link href="/app" style={{ color: "#9A98A3", fontSize: 15 }}>← Back</Link>
        <h1 style={{ fontFamily: "var(--font-home-sora)", fontWeight: 700, fontSize: 32, letterSpacing: "-0.04em" }}>Stake to win</h1>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: "#B9B3A6" }}>
          Stake your {symbol} and get a shot at weekly rewards. Your deposit is yours and you can take it out any time.
        </p>

        {loading && <p style={{ color: "#9A98A3", fontSize: 15 }}>Loading…</p>}

        {!loading && !authenticated && (
          <div style={card}><button style={btn()} onClick={() => login()}>Sign in to start</button></div>
        )}

        {!loading && authenticated && status && !status.enabled && (
          <div style={card}><p style={{ fontSize: 16, color: "#B9B3A6" }}>Staking is opening soon.</p></div>
        )}

        {!loading && authenticated && status?.enabled && !vault && (
          <div style={card}><p style={{ fontSize: 16, color: "#B9B3A6" }}>No staking pool is open right now, check back soon.</p></div>
        )}

        {!loading && authenticated && status?.enabled && vault && !status.linked && (
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 16, lineHeight: 1.5, color: "#B9B3A6" }}>
              Turn on staking for your Loofta wallet. You sign one message to confirm it is yours. No funds move.
            </p>
            <button style={btn(busy !== null)} disabled={busy !== null} onClick={enable}>{busy === "link" ? "Confirm in your wallet…" : "Turn on staking"}</button>
          </div>
        )}

        {!loading && authenticated && status?.enabled && vault && status.linked && (
          <>
            <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 16 }}>
              <Stat label="Staked" value={`${heldDisplay} ${symbol}`} />
              <Stat label="Your tickets" value={t?.totalTickets !== undefined ? String(Math.floor(Number(t.totalTickets))) : "0"} />
              <Stat label="Your odds" value={t?.sharePercent != null ? `${Number(t.sharePercent).toFixed(3)}%` : "n/a"} />
            </div>

            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: 15, color: "#9A98A3" }}>Amount to stake ({symbol})</label>
              <input
                inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ width: "100%", padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "#0f0f12", color: "#F2EFE8", fontSize: 18 }}
              />
              {!status.canTransact && <p style={{ fontSize: 15, color: "#B9B3A6" }}>Deposits open very soon.</p>}
              <button style={btn(busy !== null || !status.canTransact)} disabled={busy !== null || !status.canTransact} onClick={stake}>
                {busy === "stake" ? "Staking…" : "Stake"}
              </button>
              {Number(held?.depositsToken ?? 0) > 0 && (
                <button style={{ ...btn(busy !== null), background: "transparent", color: "#F2EFE8", border: "1px solid rgba(255,255,255,0.18)" }} disabled={busy !== null || !status.canTransact} onClick={unstakeAll}>
                  {busy === "unstake" ? "Withdrawing…" : "Withdraw everything"}
                </button>
              )}
            </div>

            {(overview?.claimable ?? []).length > 0 && (
              <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>You won</span>
                {overview!.claimable.map((p) => (
                  <div key={p.payoutId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{fromBase(p.payoutAmount, decimals)} {symbol}</span>
                    <button style={{ ...btn(busy !== null), width: "auto", padding: "10px 20px" }} disabled={busy !== null || !status.canTransact} onClick={() => claim(p.payoutId)}>
                      {busy === "claim" ? "Claiming…" : "Claim"}
                    </button>
                  </div>
                ))}
                <p style={{ fontSize: 14, color: "#77757F" }}>Claimed rewards are added to your stake. Withdraw to take them out.</p>
              </div>
            )}
          </>
        )}

        {note && <p style={{ fontSize: 15, color: "#5FD38E" }}>{note}</p>}
        {error && <p style={{ fontSize: 15, color: "#FF8A7A" }}>{error}</p>}
        <p style={{ fontSize: 14, color: "#77757F" }}>Staking is provided by Ample. Rewards are not guaranteed.</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 14, color: "#77757F" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-home-sora)", fontWeight: 700, fontSize: 20 }}>{value}</span>
    </div>
  );
}
