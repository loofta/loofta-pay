"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DepositSheet, type DepositLaunch } from "@/components/deposit/DepositSheet";
import { getSolanaHttpRpc } from "@/lib/solanaCluster";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { buildJupiterSwap } from "@/services/api/jupiterSwap";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignMessage, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import { sora, manrope, jetbrainsMono } from "@/components/home-v4/fonts";
import {
  ampleBuildClaim,
  ampleBuildDeposit,
  ampleBuildWithdraw,
  ampleBuildSetup,
  ampleSetupFee,
  ampleRecordEvent,
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
const MIN_STAKE_USD = 1;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function toBase(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const out = (w + f.padEnd(decimals, "0")).replace(/^0+/, "");
  return out === "" ? null : out;
}

// Draw time comes from Ample (GET /v1/draws/next via /ample/stats). Fallback if the call failed: Tuesday ~17:00 UTC.
const DRAW_DAY_UTC = 2; // 0 = Sunday
const DRAW_HOUR_UTC = 17;
function msToNextDraw(now: number, nextDrawAt?: string | null, intervalSec?: number | null): number {
  const base = nextDrawAt ? Date.parse(nextDrawAt) : NaN;
  if (Number.isFinite(base)) {
    const step = (intervalSec && intervalSec > 0 ? intervalSec : 604800) * 1000;
    let t = base;
    // Keep counting down past the draw without re-fetching: roll forward by whole intervals.
    if (t <= now) t += Math.ceil((now - t + 1) / step) * step;
    return t - now;
  }
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DRAW_HOUR_UTC));
  t.setUTCDate(t.getUTCDate() + ((DRAW_DAY_UTC - t.getUTCDay() + 7) % 7));
  if (t.getTime() <= now) t.setUTCDate(t.getUTCDate() + 7);
  return t.getTime() - now;
}

function Countdown({ nextDrawAt, intervalSec }: { nextDrawAt?: string | null; intervalSec?: number | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (now === null) return <div style={{ height: 40 }} />;
  let ms = msToNextDraw(now, nextDrawAt, intervalSec);
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

// Snapshot of the public "Top payouts" leaderboard on ample.money (Ample's whole savings pool, not only Loofta users). Past results.
const TOP_PAYOUTS = [
  { name: "0xcd76...a8fb", v: 2831.53, apr: 14.5 },
  { name: "I love Ample!", v: 2483.11, apr: 9.8 },
  { name: "zamn", v: 1710, apr: 23.2 },
  { name: "Jer", v: 1574.52, apr: 18.8 },
  { name: "0x350d...3248", v: 1557.22, apr: 41.7 },
];
const hue = (w: string) => [...w].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

/** What the average return means in dollars, so a non-crypto person can picture a year. */
function Calculator({ apr }: { apr: number | null }) {
  const [amt, setAmt] = useState(7600);
  if (!apr) return null;
  const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const year = (amt * apr) / 100;
  const row = (label: string, value: string, opts: { big?: boolean; color?: string; muted?: boolean } = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "clamp(10px,1.4vw,16px) 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <span style={{ fontSize: 17, fontWeight: 600, color: opts.muted ? "#8A8893" : "#F2EFE8" }}>{label}</span>
      <span style={{ fontFamily: SORA, fontWeight: 800, letterSpacing: "-0.05em", fontSize: opts.big ? "clamp(30px,3.6vw,44px)" : "clamp(24px,2.8vw,34px)", color: opts.color ?? "#F2EFE8" }}>{value}</span>
    </div>
  );
  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ fontFamily: SORA, fontWeight: 800, fontSize: "clamp(28px,3.6vw,44px)", letterSpacing: "-0.05em", margin: "0 0 clamp(14px,2vw,22px)" }}>What could you earn?</h2>
      <div style={{ padding: "clamp(18px,2.6vw,36px)", borderRadius: 32, background: "#121217", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: "24px clamp(28px,5vw,64px)", alignItems: "center" }}>
        <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: "#8A8893", fontWeight: 600 }}>
            <img src="/images/usdc.svg" alt="" style={{ width: 24, height: 24 }} />
            If you add USDC
          </div>
          <span style={{ fontFamily: SORA, fontWeight: 800, fontSize: "clamp(44px,6vw,72px)", lineHeight: 1, letterSpacing: "-0.06em" }}>${amt.toLocaleString("en-US")}</span>
          <input type="range" min={100} max={10000} step={100} value={amt} aria-label="Amount to add" onChange={(e) => setAmt(Number(e.target.value))} style={{ width: "100%", accentColor: "#EE6A2C", margin: "4px 0" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {[100, 1000, 5000, 10000].map((v) => (
              <button key={v} type="button" onClick={() => setAmt(v)}
                style={{ cursor: "pointer", padding: "10px 20px", borderRadius: 999, fontFamily: SORA, fontWeight: 800, fontSize: 17, letterSpacing: "-0.03em", color: "#F2EFE8", background: amt === v ? "#1F1F27" : "#0F0F13", border: `1px solid ${amt === v ? "rgba(238,106,44,0.7)" : "rgba(255,255,255,0.08)"}` }}>
                {v >= 1000 ? `$${v / 1000}k` : `$${v}`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: "#8A8893", paddingBottom: 2 }}>Per year</span>
          {row("Average", usd(year), { big: true, color: "#EE6A2C" })}
          {row("Top savers", `${usd(amt * 0.1)}\u2013${usd(amt * 0.42)}`)}
          {row("Bank", usd((amt * 0.5) / 100), { muted: true })}
          <span style={{ fontSize: 15, color: "#8A8893", paddingTop: 12 }}>Paid as weekly prizes. Not guaranteed.</span>
        </div>
      </div>
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const oddsText = (v: number | null) => (v === null || !Number.isFinite(v) || v <= 0 ? "-" : v * 100 < 0.01 ? "<0.01%" : `${(v * 100).toFixed(2)}%`);

const STEPS = [
  { n: "1", title: "Add dollars", sub: "Start with $1. It stays yours and you can take it out any time" },
  { n: "2", title: "Get tickets", sub: "The more you add, the more tickets you hold" },
  { n: "3", title: "Win every week", sub: "Prizes are paid from the interest your dollars earn, never from fees" },
];

const FAQ = [
  { q: "Is my money safe?", a: "Your dollars (held as USDC, a digital dollar) stay yours and you can take them out any time. They are held in a savings pool run by Ample. Like any online financial product there is a small technical risk, and prizes are never guaranteed." },
  { q: "Where do prizes come from?", a: "Every dollar in the pool earns interest. That interest is collected into weekly prizes and shared out by draw. Nobody pays to enter." },
  { q: "How do I win more often?", a: "Tickets build up the longer you stay and the more you add. More tickets means a bigger share of each draw." },
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
  const [howOpen, setHowOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("loofta_stake_onboarded")) setHowOpen(true);
    } catch { /* ignore */ }
  }, []);
  const closeHow = useCallback(() => {
    setHowOpen(false);
    try { localStorage.setItem("loofta_stake_onboarded", "1"); } catch { /* ignore */ }
  }, []);
  // Prizes already claimed are folded into the stake by Ample, so total winnings are tracked here (per user, this browser) once claimed.
  const claimedKey = userId ? `loofta_stake_won_usd_${userId}` : null;
  const [claimedBase, setClaimedBase] = useState<string>("0");
  useEffect(() => {
    try { setClaimedBase((claimedKey && localStorage.getItem(claimedKey)) || "0"); } catch { setClaimedBase("0"); }
  }, [claimedKey]);
  const addClaimed = (base: string) => {
    setClaimedBase((prev) => {
      const next = (BigInt(prev || "0") + BigInt(/^\d+$/.test(base) ? base : "0")).toString();
      try { if (claimedKey) localStorage.setItem(claimedKey, next); } catch { /* ignore */ }
      return next;
    });
  };
  // The backend prices every prize and position in USD (rates cached 2h) because they can be paid in USDC, SOL or JupUSD.
  const microOf = (p: { usdMicro?: string | null }): bigint => (p.usdMicro && /^\d+$/.test(p.usdMicro) ? BigInt(p.usdMicro) : BigInt(0));
  const [deposit, setDeposit] = useState<DepositLaunch | null>(null);
  const [firstFee, setFirstFee] = useState<number | null>(null);
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
      // The first deposit from an empty wallet carries a one-time fee. Show it up front, not as a surprise.
      if (s.enabled) ampleSetupFee(o).then((f) => setFirstFee(f.needed && f.feeUsd ? f.feeUsd : null)).catch(() => setFirstFee(null));
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
      else if (/fail on-chain|no program logs/i.test(m)) setError("The transaction would fail. Make sure your wallet holds the USDC you are staking, then try again.");
      else if (/simulation/i.test(m)) setError("That transaction would fail, check your balance and try again.");
      else if (/exceeds/i.test(m)) setError("That is more than you have staked.");
      else setError(m || "Something went wrong, try again.");
    } finally { setBusy(null); }
  };

  // Links the Loofta wallet to the savings pool. Needed once, and again if the account was linked to a different wallet.
  // Runs silently as part of the first deposit, so the user never sees a separate "turn on" step.
  const linkWallet = async () => {
    if (!wallet || !solAddress) throw new Error("No Solana wallet found");
    const o = await opts();
    const ch = await ampleChallenge(solAddress, o);
    const { signature } = await signMessage({ message: new TextEncoder().encode(ch.message), wallet, options: { uiOptions: { showWalletUIs: false } } } as never);
    await ampleLink({ walletAddress: solAddress, message: ch.message, signature: bs58.encode(signature as Uint8Array) }, o);
    await refresh();
  };
  const walletMismatch = !!(status?.linked && status.walletAddress && solAddress && status.walletAddress !== solAddress);

  // If the wallet rejects the sponsored (Loofta-paid fee) transaction, build the plain one once and let the user pay the fee.
  const buildSend = async (build: (plain?: boolean) => Promise<AmpleSolanaTx>) => {
    const first = await build();
    const d = first.diag;
    // The backend already tested the transaction on-chain. If it cannot work, say why instead of letting the wallet fail.
    if (d?.finalErr) {
      if (/^\d+$/.test(d.usdc) && /^\d+$/.test(d.requested) && BigInt(d.usdc) < BigInt(d.requested)) {
        throw new Error(`Your wallet holds $${(Number(d.usdc) / 1e6).toFixed(2)} USDC, which is less than the $${(Number(d.requested) / 1e6).toFixed(2)} you are adding.`);
      }
      if (d.sol >= 0 && d.sol < 3_000_000 && !d.sponsored) {
        throw new Error("Your wallet needs a tiny bit of SOL (about $0.50) to open your savings account the first time. Add a little SOL and try again.");
      }
    }
    try { return { tx: first, sig: await sendTx(first) }; }
    catch (e: any) {
      if (!/fail on-chain|no program logs|simulat/i.test(String(e?.message ?? ""))) throw e;
      const plain = await build(true);
      return { tx: plain, sig: await sendTx(plain) };
    }
  };

  const sendTx = async (tx: AmpleSolanaTx, silent = false) => {
    if (!wallet) throw new Error("No Solana wallet found");
    if (tx.expiresAt && Date.now() > new Date(tx.expiresAt).getTime()) throw new Error("That quote expired, try again.");
    const bytes = Uint8Array.from(atob(tx.transaction.unsigned), (c) => c.charCodeAt(0));
    const { signature } = await signAndSendTransaction({ transaction: bytes, wallet, ...(silent ? { options: { uiOptions: { showWalletUIs: false } } } : {}) } as never);
    const sig = bs58.encode(signature as Uint8Array);
    const o = await opts();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await ampleTxStatus(sig, o).catch(() => null);
      if (st?.status === "SUCCESS") return sig;
      if (st?.status === "FAILED") throw new Error("The transaction did not land. Nothing was taken.");
    }
    return null;
  };

  // Feeds the earnings ledger (total won, personal APR). Never blocks or fails the user's action.
  const report = async (kind: "deposit" | "withdraw" | "claim", amountBase: string, sig: string | null, payoutId?: string, vaultId?: string) => {
    if (!sig || !vault) return;
    // A claim without a known paying vault is never recorded: it would be priced as USDC and overstate winnings.
    if (kind === "claim" && !vaultId) return;
    try { await ampleRecordEvent({ kind, vaultId: vaultId ?? vault.id, amountBase, txSignature: sig, payoutId }, await opts()); } catch { /* ignore */ }
  };

  const heldDisplay = fromBase(held?.depositsToken, held?.token?.decimals ?? decimals);
  const usdcStaked = Number(held?.depositsToken ?? 0) > 0 ? Number(heldDisplay) : 0;
  // Prizes can land in other vaults (SOL, JupUSD). They are shown as part of one USDC value and swapped to USDC on withdrawal.
  const otherPositions = (overview?.balances ?? []).filter((b: any) => (!vault || b.vaultId !== vault.id) && Number(b.depositsToken) > 0 && b.tokenMint);
  const convertible = otherPositions.filter((b: any) => microOf(b) >= BigInt(10_000)); // $0.01 and up, smaller ones stay in the vault
  const otherUsd = otherPositions.reduce((a: number, b: any) => a + Number(microOf(b)) / 1e6, 0);
  const stakedNum = usdcStaked + otherUsd;
  const hasStake = stakedNum > 0;
  const amt = Math.max(0, Number(amount) || 0);

  const stake = () => run("stake", async () => {
    const base = toBase(amount, decimals);
    if (!base) throw new Error("Enter an amount");
    if (!vault) { void refresh(); throw new Error("Earn is not available right now. Try again in a moment."); }
    if (amt < MIN_STAKE_USD) throw new Error("The minimum is $1.");
    // Not enough USDC in the wallet: open the top-up sheet for the missing amount instead of failing on-chain.
    if (solAddress) {
      try {
        const conn = new Connection(getSolanaHttpRpc(), "confirmed");
        const bal = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(solAddress)));
        const have = Number(bal.value.amount) / 1e6;
        const need = amt + (firstFee ?? 0);
        if (have + 0.000001 < need) {
          setDeposit({ screen: "home", amount: (Math.ceil((need - have) * 100) / 100).toFixed(2) });
          return;
        }
      } catch (e: any) {
        // No USDC account yet means a balance of zero. Other RPC errors fall through to the normal flow.
        if (/could not find account|invalid param/i.test(String(e?.message ?? ""))) {
          setDeposit({ screen: "home", amount: (amt + (firstFee ?? 0)).toFixed(2) });
          return;
        }
      }
    }
    if (!status?.linked || walletMismatch) await linkWallet();
    const o = await opts();
    // A brand new wallet holds no SOL for the account rent. One small signed step swaps a little USDC for it, shown as dollars.
    const setup = await ampleBuildSetup(vault.id, base, o);
    if (setup.needed) {
      setNote(`First-time deposit fee: $${setup.feeUsd.toFixed(2)}`);
      await sendTx(setup, true);
    }
    await report("deposit", base, (await buildSend((plain) => ampleBuildDeposit(vault.id, base, o, plain))).sig);
    setNote("Done. You are in this week's draw.");
    await refresh();
  });

  // Withdrawn prize tokens are swapped to USDC with Jupiter, signed and paid for by the user's own wallet.
  const swapToUsdc = async (b: any) => {
    if (!wallet) throw new Error("No Solana wallet found");
    const dec = b.token?.decimals ?? 6;
    const raw = String(b.depositsToken).padStart(dec + 1, "0");
    const amountStr = `${raw.slice(0, raw.length - dec)}.${raw.slice(raw.length - dec)}`.replace(/\.?0+$/, "") || "0";
    const built = await buildJupiterSwap({ inputMint: b.tokenMint, outputMint: USDC_MINT, amount: amountStr, slippageBps: 100 }, userId ?? "", await getAccessToken().catch(() => null));
    const bytes = Uint8Array.from(atob(built.swapTransaction), (c) => c.charCodeAt(0));
    const { signature } = await signAndSendTransaction({ transaction: bytes, wallet });
    await waitForSignatureConfirmation(new Connection(getSolanaHttpRpc(), "confirmed"), bs58.encode(signature as Uint8Array));
  };

  const withdraw = () => run("unstake", async () => {
    if (!vault) return;
    const eps = 0.0001;
    // Asking for more than the USDC vault holds, or the whole balance, withdraws everything and converts the rest to USDC.
    const everything = amt >= stakedNum - eps || amt > usdcStaked + eps;
    let withdrawn = 0;
    if (usdcStaked > 0 && held) {
      const base = everything || amt >= usdcStaked - eps ? String(held.depositsToken) : toBase(amount, decimals);
      if (!base) throw new Error("Enter an amount");
      const o = await opts();
      const r = await buildSend((plain) => ampleBuildWithdraw(vault.id, base, o, plain));
      await report("withdraw", r.tx.withdrawnBase ?? base, r.sig);
      withdrawn++;
    }
    let converted = 0;
    let kept = 0;
    if (everything) {
      for (const b of convertible as any[]) {
        try {
          const built = await ampleBuildWithdraw(b.vaultId, String(b.depositsToken), await opts());
          await report("withdraw", built.withdrawnBase ?? String(b.depositsToken), await sendTx(built), undefined, b.vaultId);
          withdrawn++;
          try { await swapToUsdc(b); converted++; } catch (e) { console.warn("[stake] swap to USDC skipped:", e); kept++; }
        } catch (e) { console.warn("[stake] other-vault withdraw skipped:", e); kept++; }
      }
    }
    setNote(kept > 0
      ? "Withdrawn to your wallet. Some prizes could not be converted to USDC, they are in your wallet as their own token."
      : converted > 0 ? "Withdrawn to your wallet, prizes converted to USDC." : withdrawn > 0 ? "Withdrawn to your wallet." : null);
    setAmount("25");
    await refresh();
  });

  const claim = (payoutId: string) => run("claim", async () => {
    const p = overview?.claimable.find((c) => c.payoutId === payoutId);
    const o = await opts();
    const { sig } = await buildSend((plain) => ampleBuildClaim(payoutId, o, plain));
    if (p) { addClaimed(microOf(p).toString()); await report("claim", String(p.payoutAmount), sig, p.payoutId, p.vaultId); }
    setNote("Reward added to your stake.");
    await refresh();
  });

  // Ample takes one payout per transaction, so "claim all" signs them one after another.
  const claimAll = () => run("claim", async () => {
    const list = [...(overview?.claimable ?? [])];
    let done = 0;
    try {
      for (const p of list) {
        const o = await opts();
        const { sig } = await buildSend((plain) => ampleBuildClaim(p.payoutId, o, plain));
        addClaimed(microOf(p).toString());
        await report("claim", String(p.payoutAmount), sig, p.payoutId, p.vaultId);
        done++;
      }
    } finally {
      if (done > 0) { setNote(`${done} reward${done === 1 ? "" : "s"} added to your stake.`); await refresh(); }
    }
  });

  const switchTab = (t: "stake" | "withdraw") => {
    setTab(t);
    setError(null); setNote(null);
    setAmount(t === "stake" ? "25" : hasStake ? String(Math.floor(stakedNum * 10000) / 10000) : "0");
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
        { label: "Max", value: String(Math.floor(stakedNum * 10000) / 10000) },
      ];

  const linked = !!(authenticated && status?.enabled && vault && status.linked);
  let ctaLabel = isStake ? `Add $${fmt(amt)}` : `Withdraw $${fmt(eff)}`;
  let ctaDisabled = busy !== null;
  let ctaAction: () => void = isStake ? stake : withdraw;
  if (loading) { ctaLabel = "Loading..."; ctaDisabled = true; }
  else if (!authenticated) { ctaLabel = "Sign in to start"; ctaDisabled = false; ctaAction = () => login(); }
  else if (status && !status.enabled) { ctaLabel = "Earn opens soon"; ctaDisabled = true; }
  else if (status?.enabled && !vault) { ctaLabel = "No pool open right now"; ctaDisabled = true; }
  else if (status?.enabled && vault && !status.linked) {
    if (busy === "stake") ctaLabel = "Adding...";
    if (eff <= 0) ctaDisabled = true;
    else if (isStake && eff < MIN_STAKE_USD) { ctaDisabled = true; ctaLabel = "Minimum is $1"; }
    ctaAction = stake;
  }
  else if (linked) {
    if (busy === "stake") ctaLabel = "Adding...";
    if (busy === "unstake") ctaLabel = "Withdrawing...";
    if (!status?.canTransact) ctaDisabled = true;
    if (!isStake && !hasStake) ctaDisabled = true;
    if (eff <= 0) ctaDisabled = true;
    else if (isStake && eff < MIN_STAKE_USD) { ctaDisabled = true; ctaLabel = "Minimum is $1"; }
  }

  const claimableBase = (overview?.claimable ?? []).reduce((a, p) => a + microOf(p), BigInt(0));
  const usdText = (micro: bigint) => { const n = Number(micro) / 1e6; return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`; };
  const claimableTotal = usdText(claimableBase);
  const localWon = BigInt(claimedBase || "0") + claimableBase;
  const ledgerWon = overview?.totalWonBase ? BigInt(overview.totalWonBase) + claimableBase : BigInt(0);
  const wonBase = ledgerWon > localWon ? ledgerWon : localWon;
  const wonTotal = wonBase > BigInt(0) ? usdText(wonBase) : null;
  const apr = stats?.avgApr ?? null;
  const wonReturnPct = wonBase > BigInt(0) && stakedNum > 0 ? (Number(wonBase) / 1e6 / stakedNum) * 100 : null;

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
              <span style={{ display: "block" }}>{apr ? `Earn ~${pct(apr)} a year.` : "Earn on your dollars."}</span>
              <span style={{ display: "block", color: "#8A8893" }}>Win prizes every week.</span>
            </h1>
          </div>

          <div className="stk-stage">
            <div className="stk-vault"><Vault3D /></div>
          </div>

          <div className="stk-form">
            <div className="stk-pay">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#C9C6CF" }}>Next prize draw</span>
              </div>
              <Countdown nextDrawAt={stats?.nextDrawAt} intervalSec={stats?.drawIntervalSeconds} />
            </div>

            <div id="stake" style={{ padding: 8, borderRadius: 28, background: "#121217", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 40px 100px rgba(0,0,0,0.55)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 20, background: "#0B0B0E" }}>
                {(["stake", "withdraw"] as const).map((k) => (
                  <button key={k} type="button" className="stk-pad" onClick={() => switchTab(k)}
                    style={{ cursor: "pointer", border: "none", textAlign: "center", borderRadius: 16, fontWeight: 800, fontSize: 15, background: tab === k ? "#1D1D24" : "transparent", color: tab === k ? "#F2EFE8" : "#6E6C78", fontFamily: "inherit" }}>
                    {k === "stake" ? "Add money" : "Withdraw"}
                  </button>
                ))}
              </div>

              <div style={{ padding: "clamp(18px,3.2vh,30px) 20px clamp(16px,2.6vh,24px)", display: "flex", flexDirection: "column", gap: "clamp(12px,2.3vh,24px)" }}>
                {!(!isStake && hasStake) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
                    <Mini label="Your balance" value={`$${fmt(stakedNum)}`} />
                    <Mini label="Tickets" value={fmt(ticketCount)} />
                    <Mini label="Weekly odds" value={oddsText(oddsBefore)} />
                  </div>
                )}

                {!isStake && hasStake && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 18, background: "#0B0B0E", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#C9C6CF" }}>Your earnings</span>
                      <button type="button" aria-label="About your APR" aria-expanded={infoOpen} onClick={() => setInfoOpen((v) => !v)}
                        style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800, fontFamily: "inherit", lineHeight: 1, padding: 0, color: infoOpen ? "#FF8A3D" : "#8A8893", background: "transparent", border: `1.5px solid ${infoOpen ? "#FF8A3D" : "#8A8893"}` }}>
                        i
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
                      <Mini label="Your balance" value={`$${fmt(stakedNum)}`} />
                      <Mini label="Tickets" value={fmt(ticketCount)} />
                      <Mini label="Weekly odds" value={oddsText(oddsBefore)} />
                    </div>
                    <EarnRow label="Won so far" value={wonTotal ?? "$0"} strong />
                    {claimableBase > BigInt(0) ? <EarnRow label="Waiting to claim" value={claimableTotal} /> : null}
                    {overview?.yourApy !== null && overview?.yourApy !== undefined
                      ? <EarnRow label="Your APR" value={pct(overview.yourApy)} strong />
                      : apr ? <EarnRow label="Estimated yield (APR)" value={`~${pct(apr)}`} /> : null}
                    {wonReturnPct !== null ? <EarnRow label="Return so far" value={`${wonReturnPct < 0.01 ? "<0.01" : wonReturnPct.toFixed(2)}% of your stake`} /> : null}
                    {claimableBase > BigInt(0) ? (
                      <button type="button" disabled={busy !== null || !status?.canTransact} onClick={claimAll}
                        style={{ padding: "12px 24px", borderRadius: 14, border: "none", background: GRAD, color: "#fff", fontFamily: SORA, fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: busy !== null ? 0.6 : 1 }}>
                        {busy === "claim" ? "Claiming..." : `Claim all ${claimableTotal}`}
                      </button>
                    ) : null}
                    {infoOpen && (
                      <span style={{ fontSize: 15, lineHeight: 1.5, color: "#C9C6CF", padding: "10px 12px", borderRadius: 12, background: "#15151B", border: "1px solid rgba(255,255,255,0.08)" }}>
                        Your APR appears after a week of history, until then the pool average of the last month is shown. It varies from week to week and is not a promise.
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "clamp(12px,2.2vh,20px) 18px", borderRadius: 18, background: "#0B0B0E", border: `1px solid ${focus ? "rgba(255,122,42,0.6)" : "rgba(255,255,255,0.08)"}` }}>
                  <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 32, color: "#6E6C78" }}>$</span>
                  <input inputMode="decimal" aria-label={isStake ? "Amount to add" : "Amount to withdraw"} value={amount}
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
                {isStake && firstFee ? (
                  <span style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "#FFB27A" }}>{`First-time deposit fee: $${firstFee.toFixed(2)} (once). You pay $${fmt(amt + firstFee)} in total.`}</span>
                ) : null}
                <span className="stk-fine" style={{ textAlign: "center", fontSize: 15, color: "#8A8893" }}>{"Your money stays yours · withdraw any time · no entry fee · network fees paid by Loofta"}</span>
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: "clamp(56px,8vw,96px)" }}><Reveal /></section>

        {(
        <section style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>Biggest payouts on Ample</span>
            <span style={{ fontSize: 15, color: "#8A8893" }}>From Ample's public leaderboard</span>
          </div>
          <div style={{ overflow: "hidden", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)", maskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)" }}>
            <div style={{ display: "flex", gap: 12, width: "max-content", padding: "6px 0 10px", animation: "lmarquee 40s linear infinite" }}>
              {[...TOP_PAYOUTS, ...TOP_PAYOUTS, ...TOP_PAYOUTS, ...TOP_PAYOUTS].map((w, i) => (
                <div key={i} className="stk-win"
                  onMouseMove={(e) => { const el = e.currentTarget, r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.transform = `perspective(600px) rotateX(${-y * 14}deg) rotateY(${x * 16}deg) scale(1.04)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}>
                  <div style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", background: `oklch(0.78 0.14 ${hue(w.name)})`, display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: 800, fontSize: 16, color: "#0B0B0E" }}>{w.name.replace(/^0x/, "")[0].toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 20, letterSpacing: "-0.03em", lineHeight: 1.1 }}>${Math.floor(w.v).toLocaleString("en-US")}<span style={{ color: "#7A7884" }}>.{String(Math.round((w.v % 1) * 100)).padStart(2, "0")}</span></span>
                    <span style={{ fontSize: 15, color: "#A9A6B0", whiteSpace: "nowrap" }}>{w.name} · {w.apr}% a year</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        )}

        <Calculator apr={apr} />

        {stats && (
          <section style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)", background: "#101015", overflow: "hidden" }}>
            <Stat label="Paid out in prizes" value={compactUsd(stats.totalPaidUsd)} note="Funded by yield, not entry fees" />
            <Stat label="Saved by everyone" value={compactUsd(stats.tvlUsd)} note="Held in the pool right now" />
            {stats.avgApr ? <Stat label="Average yearly return" value={`~${pct(stats.avgApr)}`} note="Paid out as weekly prizes" accent /> : null}
            {stats.maxApr ? <Stat label="Best recent week, per year" value={pct(stats.maxApr)} note={`Last 30 days: ${compactUsd(stats.monthlyPayoutsUsd)} paid`} /> : null}
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
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#8A8893" }}>Savings are provided by Ample. Prizes are not guaranteed and past payouts do not predict future ones.</p>
            <a href="/docs/stake" style={{ fontSize: 15, fontWeight: 700, color: "#FF7A2A" }}>Read the full docs →</a>
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
      <DepositSheet
        open={deposit != null}
        launch={deposit}
        onClose={() => setDeposit(null)}
        balanceUsd="0.00"
        solanaAddress={solAddress || null}
        devnetMode={false}
      />
      <button type="button" onClick={() => setHowOpen(true)} aria-label="How it works"
        style={{ position: "fixed", right: 20, bottom: 20, zIndex: 60, display: "flex", alignItems: "center", gap: 10, padding: "12px 18px 12px 12px", borderRadius: 999, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "#1A1A20", color: "#F2EFE8", fontFamily: SORA, fontWeight: 700, fontSize: 15, boxShadow: "0 14px 40px rgba(0,0,0,0.5)" }}>
        <span style={{ width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", background: GRAD, color: "#fff", fontSize: 16, fontWeight: 800 }}>?</span>
        How it works
      </button>
      <HowItWorks open={howOpen} onClose={closeHow} />
    </div>
  );
}

const HOW_STEPS: { title: string; body: string; note?: string; icon: React.ReactNode }[] = [
  {
    title: "Put idle assets to work",
    body: "Earn yield-funded payouts every week, just for holding USDC in the pool.",
    icon: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17.5l9 5 9-5" /></>,
  },
  {
    title: "Deposit your money",
    body: "Your principal stays safe and always available. Withdraw any time.",
    note: "Audited by Pashov Audit Group",
    icon: <><rect x="4.5" y="11" width="15" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  },
  {
    title: "Get tickets",
    body: "Tickets represent your eligible participation in a cycle and help determine your chance of receiving a payout.",
    icon: <><path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3v3z" /><path d="M13 6v12" strokeDasharray="2 2.5" /></>,
  },
  {
    title: "Join cycles",
    body: "The protocol works in weekly cycles. Each week it distributes accrued protocol yield to winners.",
    icon: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  },
  {
    title: "Earn upside",
    body: "Up to 80 recipients receive yield-funded upside on top of your savings.",
    icon: <><path d="M8 4h8v6a4 4 0 0 1-8 0V4z" /><path d="M8 6H4v2a3 3 0 0 0 4 2.8M16 6h4v2a3 3 0 0 1-4 2.8" /><path d="M12 14v4M8 21h8M10 18h4" /></>,
  },
];

function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  const st = HOW_STEPS[i];
  const last = i === HOW_STEPS.length - 1;
  return (
    <div role="dialog" aria-modal="true" aria-label="How staking works" onClick={onClose} className="hiw-ov"
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: 16, background: "rgba(6,6,9,0.72)", backdropFilter: "blur(6px)" }}>
      <style>{`
        @media (max-width:640px){
          .hiw-icon{margin-top:auto !important}
          .hiw-cta{margin-bottom:auto !important}
          .hiw-ov{padding:0 !important;background:#0f0f12 !important;backdrop-filter:none !important}
          .hiw-card{max-width:none !important;height:100% !important;border-radius:0 !important;border:none !important;justify-content:flex-start !important;padding:max(14px,env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom)) !important}
        }
      `}</style>
      <div onClick={(e) => e.stopPropagation()} className="hiw-card"
        style={{ position: "relative", width: "100%", maxWidth: 440, borderRadius: 32, padding: "14px 20px 28px", background: "radial-gradient(90% 60% at 50% 0%,rgba(255,90,26,0.18),rgba(255,90,26,0) 70%),#121217", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 40px 100px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" aria-label="Back" onClick={() => setI(i - 1)} disabled={i === 0}
            style={{ width: 40, height: 40, flex: "none", borderRadius: 999, border: "none", cursor: i === 0 ? "default" : "pointer", background: "transparent", color: "#C9C6CF", fontSize: 24, lineHeight: 1, visibility: i === 0 ? "hidden" : "visible" }}>←</button>
          <div style={{ flex: 1, display: "flex", gap: 6 }}>
            {HOW_STEPS.map((_, n) => (
              <span key={n} style={{ flex: 1, height: 4, borderRadius: 4, background: n <= i ? GRAD : "rgba(255,255,255,0.12)" }} />
            ))}
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ width: 40, height: 40, flex: "none", borderRadius: 999, border: "none", cursor: "pointer", background: "transparent", color: "#C9C6CF", fontSize: 26, lineHeight: 1 }}>×</button>
        </div>
        <span className="hiw-icon" style={{ marginTop: 40, width: 104, height: 104, borderRadius: 32, transform: "rotate(-6deg)", display: "grid", placeItems: "center", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.5),inset 0 -6px 12px rgba(0,0,0,0.25),0 8px 0 #9C2802,0 24px 40px rgba(255,70,10,0.35)" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{st.icon}</svg>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 15, letterSpacing: "0.18em", color: "#FF6A2A" }}>{`STEP ${i + 1} OF ${HOW_STEPS.length}`}</span>
        <h2 style={{ margin: 0, fontFamily: SORA, fontWeight: 700, fontSize: 30, lineHeight: 1.1, letterSpacing: "-0.04em" }}>{st.title}</h2>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: "#A9A7B0", textWrap: "pretty" as never }}>{st.body}</p>
        {st.note && <span style={{ fontSize: 15, fontWeight: 700, color: "#F2EFE8" }}>{st.note}</span>}
        <button type="button" className="hiw-cta" onClick={() => (last ? onClose() : setI(i + 1))}
          style={{ width: "100%", marginTop: 6, cursor: "pointer", padding: "16px", borderRadius: 18, border: "none", fontFamily: SORA, fontWeight: 700, fontSize: 17, color: "#fff", background: GRAD, boxShadow: "0 12px 30px rgba(255,74,18,0.35),inset 0 1px 0 rgba(255,255,255,0.3)" }}>
          {last ? "Start staking" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function EarnRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
      <span style={{ color: "#8A8893" }}>{label}</span>
      <span style={{ fontWeight: 700, color: strong ? "#FF8A3D" : "#F2EFE8" }}>{value}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
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
