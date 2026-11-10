"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bs58 from "bs58";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignMessage, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
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
import { compactUsd, fromBase, pct, useAmpleStats } from "./useAmpleStats";
import { Vault3D } from "./Vault3D";

const ACC = "#FF5A1A";
const GRAD = "linear-gradient(90deg,#FF3D0F,#FF7A2A)";
const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";
const TICKETS_PER_DOLLAR = 100;

function toBase(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const out = (w + f.padEnd(decimals, "0")).replace(/^0+/, "");
  return out === "" ? null : out;
}

// Ample's partner API has no draw time. Observed: payouts land weekly, and on 2026-11-10 the Ample site
// showed 07h53m to the next one, i.e. Tuesday ~17:00 UTC. Re-check after a draw and fix here if it drifts.
const DRAW_DAY_UTC = 2; // 0 = Sunday
const DRAW_HOUR_UTC = 17;
function msToNextDraw(now: number): number {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DRAW_HOUR_UTC));
  t.setUTCDate(t.getUTCDate() + ((DRAW_DAY_UTC - t.getUTCDay() + 7) % 7));
  if (t.getTime() <= now) t.setUTCDate(t.getUTCDate() + 7);
  return t.getTime() - now;
}

function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (now === null) return <div style={{ height: 40 }} />;
  let ms = msToNextDraw(now);
  const dd = Math.floor(ms / 864e5); ms -= dd * 864e5;
  const hh = Math.floor(ms / 36e5); ms -= hh * 36e5;
  const mm = Math.floor(ms / 6e4);
  const ss = Math.floor((ms % 6e4) / 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const parts = [{ v: String(dd), u: "d" }, { v: p2(hh), u: "h" }, { v: p2(mm), u: "m" }, { v: p2(ss), u: "s" }];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {parts.map((c) => (
        <div key={c.u} style={{ display: "flex", alignItems: "baseline", gap: 2, padding: "7px 9px", borderRadius: 12, background: "#121217", border: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 16 }}>{c.v}</span>
          <span style={{ fontSize: 15, color: "#A9A6B0" }}>{c.u}</span>
        </div>
      ))}
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const oddsText = (v: number | null) => (v === null || !Number.isFinite(v) || v <= 0 ? "-" : v * 100 < 0.01 ? "<0.01%" : `${(v * 100).toFixed(2)}%`);

// Mocked until Ample exposes next-payout size and a winners feed.
const NEXT_PAYOUT = ["$297", ".90"];
const MOCK_WINNERS = [
  { handle: "mira.sol", v: 85.08, ago: "6 days ago", hue: 25 },
  { handle: "0xkenji", v: 45.07, ago: "13 days ago", hue: 60 },
  { handle: "dorothy", v: 112.17, ago: "20 days ago", hue: 140 },
  { handle: "looftaxyz", v: 76.76, ago: "27 days ago", hue: 300 },
  { handle: "satsmaxi", v: 797.85, ago: "41 days ago", hue: 200 },
];

const STEPS = [
  { n: "1", title: "Stake USDC", sub: "Your funds stay yours" },
  { n: "2", title: "Collect tickets", sub: "More staked, more chances" },
  { n: "3", title: "Win every week", sub: "Funded by generated yield" },
];

const FAQ = [
  { q: "Can I lose my deposit?", a: "Your USDC sits in an Ample vault and stays yours. Withdraw any time. Like any DeFi product there is smart contract risk, and prizes are never guaranteed." },
  { q: "Where do prizes come from?", a: "Every dollar in the pool earns yield. That yield is pooled into weekly prizes. Nobody pays to enter." },
  { q: "How do I win more often?", a: "Tickets build up the longer you stay staked and the more you stake. More tickets means a bigger share of each draw." },
];

export function StakeToWin() {
  const { authenticated, userId, login, getAccessToken } = useAuth();
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { data: stats } = useAmpleStats();

  const [status, setStatus] = useState<AmpleStatus | null>(null);
  const [overview, setOverview] = useState<AmpleOverview | null>(null);
  const [tab, setTab] = useState<"stake" | "withdraw">("stake");
  const [amount, setAmount] = useState("25");
  const [focus, setFocus] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const a = new URLSearchParams(window.location.search).get("amount");
      if (a && /^\d+(\.\d+)?$/.test(a)) setAmount(a);
    } catch { /* ignore */ }
  }, []);

  const solAddress = useMemo(() => {
    const acc = (user?.linkedAccounts ?? []).find(
      (a: any) => a.type === "wallet" && a.chainType === "solana" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2"),
    ) as any;
    return (acc?.address as string | undefined) ?? "";
  }, [user]);
  const wallet = wallets.find((w) => w.address === solAddress) ?? wallets[0];

  const opts = useCallback(async () => ({ userId: userId ?? undefined, accessToken: await getAccessToken().catch(() => null) }), [userId, getAccessToken]);

  const vault = status?.vaults?.[0];
  const decimals = vault?.token?.decimals ?? stats?.decimals ?? 6;
  const symbol = vault?.token?.symbol ?? stats?.symbol ?? "USDC";
  const held =
    overview?.balances.find((b: any) => vault && (b.vaultId === vault.id || b.vault?.id === vault.id)) ??
    overview?.balances.find((b) => b.token?.symbol === symbol);

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

  const heldDisplay = fromBase(held?.depositsToken, held?.token?.decimals ?? decimals);
  const stakedNum = Number(held?.depositsToken ?? 0) > 0 ? Number(heldDisplay) : 0;
  const hasStake = stakedNum > 0;
  const amt = Math.max(0, Number(amount) || 0);

  const stake = () => run("stake", async () => {
    const base = toBase(amount, decimals);
    if (!base || !vault) throw new Error("Enter an amount");
    await sendTx(await ampleBuildDeposit(vault.id, base, await opts()));
    setNote("Staked. You are in the next draw.");
    await refresh();
  });

  const withdraw = () => run("unstake", async () => {
    if (!vault || !held) return;
    const full = amt >= stakedNum;
    const base = full ? String(held.depositsToken) : toBase(amount, decimals);
    if (!base) throw new Error("Enter an amount");
    await sendTx(await ampleBuildWithdraw(vault.id, base, await opts()));
    setNote("Withdrawn to your wallet.");
    setAmount("25");
    await refresh();
  });

  const claim = (payoutId: string) => run("claim", async () => {
    await sendTx(await ampleBuildClaim(payoutId, await opts()));
    setNote("Reward added to your stake.");
    await refresh();
  });

  const switchTab = (t: "stake" | "withdraw") => {
    setTab(t);
    setError(null); setNote(null);
    setAmount(t === "stake" ? "25" : hasStake ? heldDisplay : "0");
  };

  const t = overview?.tickets;
  const ticketCount = t?.totalTickets !== undefined ? Math.floor(Number(t.totalTickets)) : 0;
  const pool = stats?.tvlUsd ?? 0;
  const isStake = tab === "stake";
  const eff = isStake ? amt : Math.min(amt, stakedNum);
  const after = isStake ? stakedNum + eff : Math.max(0, stakedNum - eff);
  const oddsBefore = pool > 0 && stakedNum > 0 ? stakedNum / pool : null;
  const oddsAfter = pool > 0 && after > 0 ? after / (pool + (isStake ? eff : -eff)) : null;

  const presets: { label: string; value: string }[] = isStake
    ? [10, 50, 100, 500].map((v) => ({ label: `$${v}`, value: String(v) }))
    : [
        { label: "25%", value: String(Math.floor(stakedNum * 25) / 100) },
        { label: "50%", value: String(Math.floor(stakedNum * 50) / 100) },
        { label: "Max", value: heldDisplay },
      ];

  const linked = !!(authenticated && status?.enabled && vault && status.linked);
  let ctaLabel = isStake ? `Stake $${fmt(amt)}` : `Withdraw $${fmt(eff)}`;
  let ctaDisabled = busy !== null;
  let ctaAction: () => void = isStake ? stake : withdraw;
  if (loading) { ctaLabel = "Loading..."; ctaDisabled = true; }
  else if (!authenticated) { ctaLabel = "Sign in to start"; ctaDisabled = false; ctaAction = () => login(); }
  else if (status && !status.enabled) { ctaLabel = "Staking opens soon"; ctaDisabled = true; }
  else if (status?.enabled && !vault) { ctaLabel = "No pool open right now"; ctaDisabled = true; }
  else if (status?.enabled && vault && !status.linked) { ctaLabel = busy === "link" ? "Confirm in your wallet..." : "Turn on staking"; ctaAction = enable; }
  else if (linked) {
    if (busy === "stake") ctaLabel = "Staking...";
    if (busy === "unstake") ctaLabel = "Withdrawing...";
    if (!status?.canTransact) ctaDisabled = true;
    if (!isStake && !hasStake) ctaDisabled = true;
    if (eff <= 0) ctaDisabled = true;
  }

  const winners = (overview?.claimable ?? []).length > 0;

  return (
    <div
      className={`${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
      style={{ minHeight: "calc(100vh - var(--header-h, 0px))", background: "radial-gradient(900px 520px at 78% 18%,rgba(255,74,18,0.10),rgba(255,74,18,0) 70%),#0f0f12", color: "#F2EFE8", fontFamily: "var(--font-home-manrope), system-ui, sans-serif", overflow: "hidden" }}
    >
      <style>{`
        @keyframes lmarquee{to{transform:translateX(-50%)}}
        .stk-hero{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"title" "stage" "form";column-gap:clamp(24px,4vw,56px);row-gap:8px;align-content:center;align-items:start}
        .stk-title{grid-area:title;align-self:end;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:24px}
        .stk-stage{grid-area:stage;min-width:0;display:flex;justify-content:center}
        .stk-vault{position:relative;width:min(100%,600px);height:clamp(220px,34vh,300px);background:radial-gradient(closest-side,rgba(255,74,18,0.2),rgba(255,74,18,0) 80%)}
        .stk-form{grid-area:form;width:100%;max-width:480px;min-width:0;justify-self:center;align-self:center;display:flex;flex-direction:column;gap:24px}
        .stk-pad{padding:clamp(9px,1.5vh,13px)}
        .stk-fine{display:block}
        .stk-pay{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:0 8px}
        .stk-preset:hover{border-color:rgba(255,122,42,0.5)!important}
        .stk-cta:hover:not(:disabled){filter:brightness(1.08)}
        .stk-win{flex:none;display:flex;align-items:center;gap:12px;padding:12px 18px 12px 12px;border-radius:18px;background:#14141A;border:1px solid rgba(255,255,255,0.09);transition:transform .25s ease-out}
        .stk-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
        @media (min-width:900px){
          .stk-hero{grid-template-columns:minmax(0,1fr) 480px;grid-template-areas:"title form" "stage form";row-gap:0;min-height:calc(100vh - var(--header-h,0px) - 48px)}
          .stk-title{align-items:flex-start;text-align:left;margin-bottom:0}
          .stk-stage{justify-content:flex-start}
          .stk-vault{height:clamp(200px,calc(100vh - var(--header-h,0px) - 400px),460px)}
        }
        @media (max-height:640px){ .stk-fine{display:none} }
      `}</style>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(16px,4vh,32px) clamp(16px,4vw,28px) 80px", boxSizing: "border-box" }}>
        <section className="stk-hero">
          <div className="stk-title">
            <h1 style={{ margin: 0, fontFamily: SORA, fontWeight: 800, fontSize: "clamp(36px,min(4.8vw,7.5vh),72px)", lineHeight: 1, letterSpacing: "-0.055em" }}>
              <span style={{ display: "block" }}>Stake USDC.</span>
              <span style={{ display: "block", color: "#8A8893" }}>Win every week.</span>
            </h1>
          </div>

          <div className="stk-stage">
            <div className="stk-vault"><Vault3D /></div>
          </div>

          <div className="stk-form">
            <div className="stk-pay">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#C9C6CF" }}>Next payout</span>
                <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: "clamp(36px,min(4vw,6vh),48px)", lineHeight: 1, letterSpacing: "-0.06em" }}>
                  {NEXT_PAYOUT[0]}<span style={{ color: "#7A7884" }}>{NEXT_PAYOUT[1]}</span>
                </span>
              </div>
              <Countdown />
            </div>

          {winners && (
            <div style={{ padding: 20, borderRadius: 24, background: "linear-gradient(135deg,#2A150C,#16110D 70%)", border: "1px solid rgba(255,90,26,0.45)", display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: 22, color: ACC }}>You won!</span>
              {overview!.claimable.map((p) => (
                <div key={p.payoutId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontFamily: SORA, fontSize: 22, fontWeight: 700 }}>{fromBase(p.payoutAmount, decimals)} {symbol}</span>
                  <button
                    disabled={busy !== null || !status?.canTransact}
                    onClick={() => claim(p.payoutId)}
                    style={{ padding: "12px 24px", borderRadius: 14, border: "none", background: GRAD, color: "#fff", fontFamily: SORA, fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: busy !== null ? 0.6 : 1 }}
                  >
                    {busy === "claim" ? "Claiming..." : "Claim"}
                  </button>
                </div>
              ))}
              <p style={{ margin: 0, fontSize: 15, color: "#9A98A3" }}>Claimed prizes are added to your stake. Withdraw to take them out.</p>
            </div>
          )}
            <div id="stake" style={{ padding: 8, borderRadius: 28, background: "#121217", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 40px 100px rgba(0,0,0,0.55)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 20, background: "#0B0B0E" }}>
                {(["stake", "withdraw"] as const).map((k) => (
                  <button key={k} type="button" className="stk-pad" onClick={() => switchTab(k)}
                    style={{ cursor: "pointer", border: "none", textAlign: "center", borderRadius: 16, fontWeight: 800, fontSize: 15, background: tab === k ? "#1D1D24" : "transparent", color: tab === k ? "#F2EFE8" : "#6E6C78", fontFamily: "inherit" }}>
                    {k === "stake" ? "Stake" : "Withdraw"}
                  </button>
                ))}
              </div>

              <div style={{ padding: "clamp(18px,3.2vh,30px) 20px clamp(16px,2.6vh,24px)", display: "flex", flexDirection: "column", gap: "clamp(12px,2.3vh,24px)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <Mini label="Your stake" value={`$${fmt(stakedNum)}`} />
                  <Mini label="Tickets" value={fmt(ticketCount)} />
                  <Mini label="Weekly odds" value={oddsText(oddsBefore)} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "clamp(12px,2.2vh,20px) 18px", borderRadius: 18, background: "#0B0B0E", border: `1px solid ${focus ? "rgba(255,122,42,0.6)" : "rgba(255,255,255,0.08)"}` }}>
                  <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 32, color: ACC }}>$</span>
                  <input inputMode="decimal" aria-label={isStake ? "Amount to stake" : "Amount to withdraw"} value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: SORA, fontWeight: 700, fontSize: 28, letterSpacing: "-0.03em" }} />
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, color: "#8A8893" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/images/usdc.svg" alt="" style={{ width: 18, height: 18 }} />
                    {symbol}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: `repeat(${presets.length},1fr)`, gap: 8 }}>
                  {presets.map((pr) => {
                    const on = pr.value === amount;
                    return (
                      <button key={pr.label} type="button" className="stk-pad stk-preset" onClick={() => setAmount(pr.value)}
                        style={{ cursor: "pointer", textAlign: "center", borderRadius: 14, fontWeight: 700, fontSize: 15, background: on ? "rgba(255,90,26,0.12)" : "#0B0B0E", border: `1px solid ${on ? "rgba(255,122,42,0.6)" : "rgba(255,255,255,0.08)"}`, color: on ? "#FF8A3D" : "#F2EFE8", fontFamily: "inherit" }}>
                        {pr.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15, color: "#8A8893" }}>
                  <span>{isStake ? "+" : "−"}{fmt(eff * TICKETS_PER_DOLLAR)} tickets</span>
                  <span style={{ fontWeight: 700, color: "#F2EFE8" }}>Odds {oddsText(oddsBefore)} → {oddsText(oddsAfter)}</span>
                </div>

                <button type="button" className="stk-cta" disabled={ctaDisabled} onClick={ctaAction}
                  style={{ cursor: ctaDisabled ? "default" : "pointer", border: "none", textAlign: "center", padding: "clamp(14px,2.3vh,20px)", borderRadius: 18, fontFamily: SORA, fontWeight: 700, fontSize: 17, color: ctaDisabled ? "#77757F" : "#fff", background: ctaDisabled ? "#2A2A32" : GRAD, boxShadow: ctaDisabled ? "none" : "0 12px 30px rgba(255,74,18,0.35),inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                  {ctaLabel}
                </button>

                {note && <p style={{ margin: 0, fontSize: 15, color: "#5FD38E", textAlign: "center" }}>{note}</p>}
                {error && <p style={{ margin: 0, fontSize: 15, color: "#FF8A7A", textAlign: "center" }}>{error}</p>}
                <span className="stk-fine" style={{ textAlign: "center", fontSize: 15, color: "#8A8893" }}>Principal stays yours · no lockup · no entry fee</span>
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: "clamp(56px,8vw,96px)" }}><Reveal /></section>

        <section style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>Latest payouts</span>
            <span style={{ fontSize: 15, color: "#8A8893" }}>Paid every week</span>
          </div>
          <div style={{ overflow: "hidden", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)", maskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)" }}>
            <div style={{ display: "flex", gap: 12, width: "max-content", padding: "6px 0 10px", animation: "lmarquee 40s linear infinite" }}>
              {[...MOCK_WINNERS, ...MOCK_WINNERS, ...MOCK_WINNERS, ...MOCK_WINNERS].map((w, i) => (
                <div key={i} className="stk-win"
                  onMouseMove={(e) => { const el = e.currentTarget, r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.transform = `perspective(600px) rotateX(${-y * 14}deg) rotateY(${x * 16}deg) scale(1.04)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}>
                  <div style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", background: `oklch(0.78 0.14 ${w.hue})`, display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 16, color: "#0B0B0E" }}>{w.handle.replace(/^0x/, "")[0].toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em", lineHeight: 1.1 }}>${Math.floor(w.v)}<span style={{ color: "#7A7884" }}>.{String(Math.round((w.v % 1) * 100)).padStart(2, "0")}</span></span>
                    <span style={{ fontSize: 15, color: "#A9A6B0", whiteSpace: "nowrap" }}>@{w.handle} · {w.ago}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {stats && (
          <section style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)", background: "#101015", overflow: "hidden" }}>
            <Stat label="Paid to stakers" value={compactUsd(stats.totalPaidUsd)} note="Funded by yield, not entry fees" />
            <Stat label="In the pool" value={compactUsd(stats.tvlUsd)} note="USDC staked right now" />
            {stats.avgApr ? <Stat label="Average yearly yield" value={`~${pct(stats.avgApr)}`} note="Goes into the weekly prize" accent /> : null}
            {stats.maxApr ? <Stat label="Best week, annualised" value={pct(stats.maxApr)} note={`Last 30 days: ${compactUsd(stats.monthlyPayoutsUsd)} paid`} /> : null}
          </section>
        )}

        <section style={{ marginTop: 96, display: "flex", flexDirection: "column", gap: 32 }}>
          <h2 style={{ margin: 0, fontFamily: SORA, fontWeight: 800, fontSize: 36, letterSpacing: "-0.05em" }}>How it works</h2>
          <div className="stk-steps">
            {STEPS.map((st) => (
              <div key={st.n} style={{ position: "relative", overflow: "hidden", padding: 28, borderRadius: 24, background: "linear-gradient(160deg,#17141A,#111115 60%)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 56, minHeight: 220, boxSizing: "border-box" }}>
                <span aria-hidden style={{ position: "absolute", right: -6, top: -34, fontFamily: SORA, fontWeight: 800, fontSize: 180, lineHeight: 1, letterSpacing: "-0.08em", color: "transparent", WebkitTextStroke: "1.5px rgba(255,122,42,0.22)" }}>{st.n}</span>
                <span style={{ position: "relative", width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg,#FF3D0F,#FF8A2A)", boxShadow: "0 10px 24px rgba(255,74,18,0.35),inset 0 1px 0 rgba(255,255,255,0.35)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 22, color: "#0B0B0E" }}>{st.n}</span>
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{st.title}</span>
                  <span style={{ fontSize: 15, color: "#8A8893" }}>{st.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 96, display: "flex", flexWrap: "wrap", gap: "24px 40px", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
            <h2 style={{ margin: 0, fontFamily: SORA, fontWeight: 800, fontSize: 36, letterSpacing: "-0.05em" }}>Questions</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#8A8893" }}>Staking is provided by Ample. Prizes are not guaranteed and past payouts do not predict future ones.</p>
          </div>
          <div style={{ flex: "2 1 320px", minWidth: 0, display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {FAQ.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <button type="button" onClick={() => setOpenFaq(open ? -1 : i)}
                    style={{ width: "100%", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "22px 0", fontWeight: 700, fontSize: 17, background: "transparent", border: 0, color: "inherit", textAlign: "left", fontFamily: "inherit" }}>
                    {f.q}
                    <span style={{ flex: "none", width: 30, height: 30, borderRadius: "50%", background: "#17171D", display: "grid", placeItems: "center", fontSize: 18, color: "#FF7A2A" }}>{open ? "−" : "+"}</span>
                  </button>
                  {open && <p style={{ margin: "0 0 22px", maxWidth: 600, fontSize: 16, lineHeight: 1.6, color: "#A9A6B0" }}>{f.a}</p>}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 15, color: "#8A8893" }}>{label}</span>
      <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function Stat({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "inset -1px -1px 0 rgba(255,255,255,0.07)" }}>
      <span style={{ fontSize: 15, color: "#8A8893" }}>{label}</span>
      <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: 32, letterSpacing: "-0.05em", color: accent ? ACC : "#F2EFE8" }}>{value}</span>
      <span style={{ fontSize: 15, color: "#6E6C78" }}>{note}</span>
    </div>
  );
}

const REVEAL = [
  ...("Earn tickets over time for a chance at yield-funded weekly prizes.".split(" ").map((t) => [t, "#F2EFE8"] as const)),
  ...("Withdraw any time.".split(" ").map((t) => [t, "#8A8893"] as const)),
];

/** Big statement whose words light up as it scrolls into view. */
function Reveal() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect(), vh = window.innerHeight;
      const v = Math.max(0, Math.min(1, (vh * 0.85 - r.top) / (vh * 0.55)));
      setP(Math.round(v * 40) / 40);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  const lit = p * REVEAL.length;
  return (
    <p ref={ref} style={{ margin: 0, fontFamily: SORA, fontWeight: 700, fontSize: "clamp(32px,5.2vw,72px)", lineHeight: 1.12, letterSpacing: "-0.045em" }}>
      {REVEAL.map(([t, c], i) => (
        <span key={i} style={{ color: i < lit ? c : "#3A3942", transition: "color .25s ease" }}>{t}{i < REVEAL.length - 1 ? " " : ""}</span>
      ))}
    </p>
  );
}
