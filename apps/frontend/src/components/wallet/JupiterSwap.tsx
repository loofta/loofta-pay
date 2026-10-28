"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDown, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/components/ui/use-toast";
import type { WalletHolding } from "@/hooks/useWalletHoldings";
import { useLooftaSigner } from "@/components/deposit/DepositSheet";
import { WalletTokenLogo } from "@/components/wallet/WalletTokenLogo";
import type { PickToken } from "@/components/wallet/JupiterTokenPicker";
import { buildJupiterSwap, quoteJupiterSwap, submitJupiterSwap, type JupiterSwapQuote } from "@/services/api/jupiterSwap";
import { Connection } from "@solana/web3.js";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { getPrivySolanaChainForMode, getRpcForMode } from "@/lib/solanaRpc";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { tagWalletTx } from "@/lib/walletActivityTags";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_PILL } from "@/components/wallet/walletStyles";
import { LOW_SLIPPAGE_BPS, HIGH_SLIPPAGE_BPS, formatSlippage } from "@/components/wallet/SlippageSettings";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const IMPACT_WARN_PCT = 1; // yellow
const IMPACT_DANGER_PCT = 5; // red, the button becomes "Swap anyway"
const IMPACT_BLOCK_PCT = 20; // so much value would be lost that we do not allow it
const SOL_RESERVE = 0.01; // kept back when paying with SOL so the network fee can still be paid

const card = { display: "flex", flexDirection: "column", gap: 8, padding: 16, borderRadius: 22, background: "#1A1A20", border: "1px solid rgba(255,255,255,0.07)" } as const;
const fmt = (n: number, max = 6) => n.toLocaleString("en-US", { maximumSignificantDigits: max });
const baseToHuman = (base: string, decimals: number) => Number(base) / 10 ** decimals;

export function holdingToPick(h: WalletHolding): PickToken & { balance: number } {
  return { mint: h.mint ?? WSOL, symbol: h.symbol, name: h.name, icon: h.logo ?? null, decimals: h.decimals, usdPrice: h.usd != null && h.amount > 0 ? h.usd / h.amount : null, balance: h.amount };
}

/** Solana token swap on Jupiter, with Loofta's 0.80% fee already taken out of what you receive. */
export function JupiterSwap({
  holdings,
  solanaAddress,
  pay,
  get,
  onOpenPicker,
  onSetGet,
  slippageBps,
  onOpenSlippage,
  onClose,
  onDone,
}: {
  holdings: WalletHolding[];
  solanaAddress: string | null;
  pay: PickToken | null;
  get: PickToken | null;
  onOpenPicker: (side: "pay" | "get") => void;
  onSetGet: (t: PickToken) => void;
  slippageBps: number;
  onOpenSlippage: () => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { user, getAccessToken } = usePrivy();
  const { toast } = useToast();
  const networkMode = useAuthStore((s) => s.networkMode);
  const cluster = networkMode === "devnet" ? "devnet" : "mainnet";
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);

  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<JupiterSwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ sig: string; out: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [invertRate, setInvertRate] = useState(false);
  const reqRef = useRef(0);

  const solHolding = holdings.find((h) => h.mint === null);
  const solUsd = solHolding && solHolding.amount > 0 && solHolding.usd != null ? solHolding.usd / solHolding.amount : null;
  const payHolding = pay ? holdings.find((h) => (h.mint ?? WSOL) === pay.mint) : undefined;
  const balance = payHolding?.amount ?? 0;
  const amountNum = Number(amount);
  const isNative = pay?.mint === WSOL;
  const maxAmount = Math.max(0, isNative ? balance - SOL_RESERVE : balance);
  const over = amountNum > maxAmount + 1e-12;
  const sameToken = !!pay && !!get && pay.mint === get.mint;

  // Default the receive side once: USDC, or SOL when you are paying with USDC.
  useEffect(() => {
    if (get || !pay) return;
    const target = pay.mint === USDC ? WSOL : USDC;
    void (async () => {
      try {
        const r = await fetch(`/api/tokens/jupiter/search?q=${target}`);
        const t = ((await r.json()) as { tokens?: PickToken[] }).tokens?.find((x) => x.mint === target);
        if (t) onSetGet(t);
      } catch { /* picker still works */ }
    })();
  }, [get, pay, onSetGet]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!pay || !get || sameToken || !(amountNum > 0) || !user?.id || cluster !== "mainnet") return;
    const id = ++reqRef.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const access = await getAccessToken();
        const q = await quoteJupiterSwap({ inputMint: pay.mint, outputMint: get.mint, amount: String(amount), slippageBps }, user.id, access);
        if (reqRef.current === id) setQuote(q);
      } catch (e) {
        if (reqRef.current === id) setQuoteError(e instanceof Error ? e.message.replace(/^HTTP \d+:\s*/, "") : "No route found");
      } finally {
        if (reqRef.current === id) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [pay, get, amount, amountNum, sameToken, user?.id, getAccessToken, cluster, slippageBps]);

  const go = async () => {
    if (!wallet || !pay || !get || !user?.id || !quote || over) return;
    setBusy(true);
    try {
      const access = await getAccessToken();
      const built = await buildJupiterSwap({ inputMint: pay.mint, outputMint: get.mint, amount: String(amount), slippageBps }, user.id, access);
      const bytes = Uint8Array.from(Buffer.from(built.swapTransaction, "base64"));
      const { signedTransaction } = await signTransaction({ transaction: bytes, wallet, chain: getPrivySolanaChainForMode(cluster), options: { uiOptions: { showWalletUIs: false } } });
      let sig: string;
      if (built.gasless && built.id) {
        // USDC to SOL is gasless: the backend checks this is the swap it prepared, then co-signs and sends it.
        ({ signature: sig } = await submitJupiterSwap({ id: built.id, signedTransaction: Buffer.from(signedTransaction).toString("base64") }, user.id, access));
      } else {
        const connection = new Connection(getRpcForMode(cluster), "confirmed");
        sig = await connection.sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
        await waitForSignatureConfirmation(connection, sig, 120_000, 1500, "walletJupiterSwap");
      }
      tagWalletTx(sig, { kind: "swap", label: "Jupiter" });
      setSent({ sig, out: `${fmt(baseToHuman(built.outAmount, built.outDecimals))} ${get.symbol}` });
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Swap failed";
      if (!/reject|cancel|denied/i.test(msg)) toast({ variant: "destructive", title: "Swap failed", description: msg.replace(/^HTTP \d+:\s*/, "") });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 12 }}>
        <div style={{ width: 84, height: 84, borderRadius: 28, background: "radial-gradient(120% 120% at 28% 18%,#B8F5D0 0%,#3CB371 48%,#23864F 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #17603A,0 24px 40px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontSize: 40, color: "#fff", fontWeight: 800 }}>✓</div>
        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>Swap complete</span>
        <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", maxWidth: 320 }}>You received about {sent.out}.</span>
        <a href={getExplorerTxUrl("solana", sent.sig)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#9CC8FF" }}>
          <ExternalLink size={16} /> View transaction
        </a>
        <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%", marginTop: "auto" }}>Done</button>
      </div>
    );
  }

  const feePct = quote ? (quote.feeBps / 100).toFixed(2) : "0.80";
  // Jupiter reports price impact as a fraction (0.001 = 0.1%).
  const impactPct = quote ? Math.abs(quote.priceImpactPct) * 100 : null;
  const impactText = impactPct == null ? "-" : impactPct > 0 && impactPct < 0.01 ? "<0.01%" : `${impactPct.toFixed(2)}%`;
  const impactColor = impactPct == null ? "#F2EFE8" : impactPct >= IMPACT_DANGER_PCT ? "#FF7A6A" : impactPct >= IMPACT_WARN_PCT ? "#F5D547" : "#F2EFE8";
  const impactBlocked = impactPct != null && impactPct >= IMPACT_BLOCK_PCT;
  const networkFeeSol = quote?.networkFeeLamports != null ? quote.networkFeeLamports / 1e9 : null;
  // Network fee = what the network charges, like Phantom's "$0.02". Refundable account deposits are not listed as a fee.
  const gaslessFeeUsd = quote?.gasless ? Number(quote.networkFeeUsdc ?? quote.networkCostUsdc ?? 0) / 1e6 : null;
  const networkFeeText =
    gaslessFeeUsd != null
      ? `$${gaslessFeeUsd.toFixed(2)}`
      : networkFeeSol == null
        ? "-"
        : solUsd != null
          ? `$${(networkFeeSol * solUsd).toFixed(2)}`
          : `${networkFeeSol.toFixed(4)} SOL`;
  const solBalance = solHolding?.amount ?? 0;
  const isGaslessPair = pay?.mint === USDC && get?.mint === WSOL;
  const lacksSol = solBalance < 0.003 && !isGaslessPair;
  const outHuman = quote ? baseToHuman(quote.outAmount, quote.outDecimals) : null;
  const minHuman = quote ? baseToHuman(quote.minOutAmount, quote.outDecimals) : null;
  const feeHuman = quote ? baseToHuman(quote.feeAmount, quote.outDecimals) : null;
  const rate = outHuman && amountNum > 0 ? outHuman / amountNum : null;
  const payUsd = pay?.usdPrice && amountNum > 0 ? amountNum * pay.usdPrice : null;
  const getUsd = get?.usdPrice && outHuman ? outHuman * get.usdPrice : null;
  const pill = (t: PickToken | null, side: "pay" | "get") => (
    <button type="button" onClick={() => onOpenPicker(side)} style={{ cursor: "pointer", flex: "none", display: "flex", alignItems: "center", gap: 8, padding: t ? "5px 12px 5px 5px" : "10px 14px", borderRadius: 999, border: 0, background: "#26262E", color: "#F2EFE8", fontWeight: 700, fontSize: 15 }}>
      {t ? <WalletTokenLogo symbol={t.symbol} chain="Solana" logo={t.icon ?? undefined} mint={t.mint} size={30} /> : null}
      {t ? t.symbol : "Select token"}
      <span style={{ fontSize: 11, color: "#77757F" }}>▾</span>
    </button>
  );

  let cta = "Swap";
  if (cluster !== "mainnet") cta = "Swaps run on mainnet";
  else if (!pay) cta = "You have nothing to swap";
  else if (!get) cta = "Select a token";
  else if (sameToken) cta = "Pick two different tokens";
  else if (over) cta = `Not enough ${pay.symbol}`;
  else if (amountNum > 0 && quoteError) cta = "No route found";
  else if (impactBlocked) cta = "Price impact too high";
  else if (impactPct != null && impactPct >= IMPACT_DANGER_PCT) cta = "Swap anyway";
  const ready = !!wallet && !!pay && !!get && !sameToken && !over && !!quote && cluster === "mainnet" && !impactBlocked;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: "#77757F" }}>
          <span>You pay</span>
          <span style={{ whiteSpace: "nowrap" }}>Balance {fmt(balance, 6)} {pay?.symbol ?? ""}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label="Amount to pay" style={{ flex: 1, minWidth: 0, height: 44, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: SORA, fontWeight: 600, fontSize: 24 }} />
          {pill(pay, "pay")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#77757F" }}>
          <span>{payUsd != null ? `≈ $${payUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}</span>
          <button type="button" onClick={() => pay && setAmount(maxAmount > 0 ? String(Number(maxAmount.toFixed(Math.min(pay.decimals, 9)))) : "")} style={{ ...FIELD_PILL, height: 28, fontSize: 13, padding: "0 12px" }}>Max</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "-22px 0", position: "relative", zIndex: 1 }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, background: "radial-gradient(120% 120% at 28% 18%,#9CC8FF 0%,#2775CA 48%,#1A55A0 100%)", boxShadow: "inset 0 3px 6px rgba(255,255,255,0.45),0 4px 0 #123E78", border: "4px solid #121216", display: "grid", placeItems: "center" }}>
          <ArrowDown size={18} color="#fff" />
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#77757F" }}>
          <span>You get</span>
          <span>on Solana</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", fontFamily: SORA, fontWeight: 600, fontSize: 24, color: outHuman != null ? "#F2EFE8" : "#5D5B66", overflow: "hidden", textOverflow: "ellipsis" }}>
            {quoting ? "…" : outHuman != null ? fmt(outHuman) : "0"}
          </span>
          {pill(get, "get")}
        </div>
        <div style={{ fontSize: 13, color: "#77757F", minHeight: 18 }}>{getUsd != null ? `≈ $${getUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}</div>
      </div>

      {quoteError && amountNum > 0 && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>{quoteError}</span>}

      <div style={{ borderRadius: 18, background: "#1E1E22", overflow: "hidden", fontSize: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px" }}>
          <span style={{ color: "#9A98A3" }}>Pricing</span>
          <button type="button" onClick={() => setInvertRate((v) => !v)} disabled={!rate} aria-label="Flip price" style={{ cursor: rate ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: 0, color: "#F2EFE8", fontSize: 14, fontWeight: 600 }}>
            {rate && pay && get ? (invertRate ? `1 ${get.symbol} ≈ ${fmt(1 / rate)} ${pay.symbol}` : `1 ${pay.symbol} ≈ ${fmt(rate)} ${get.symbol}`) : "-"}
            {rate ? <span style={{ color: "#77757F" }}>⇄</span> : null}
          </button>
        </div>
        <button type="button" onClick={onOpenSlippage} style={{ cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", background: "none", border: 0, borderTop: "1px solid #000", color: "#F2EFE8", fontSize: 14, textAlign: "left" }}>
          <span style={{ color: "#9A98A3" }}>Slippage</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, color: slippageBps < LOW_SLIPPAGE_BPS || slippageBps >= HIGH_SLIPPAGE_BPS ? "#F5D547" : "#F2EFE8" }}>
            {slippageBps < LOW_SLIPPAGE_BPS ? "Low slippage tolerance" : slippageBps >= HIGH_SLIPPAGE_BPS ? `High, ${formatSlippage(slippageBps)}` : formatSlippage(slippageBps)}
            <span style={{ color: "#77757F" }}>›</span>
          </span>
        </button>
        <button type="button" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen} style={{ cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", background: "none", border: 0, borderTop: "1px solid #000", color: "#F2EFE8", fontSize: 14, textAlign: "left" }}>
          <span style={{ color: "#9A98A3" }}>Network fee</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            {networkFeeText}
            <span style={{ color: "#77757F", display: "inline-block", transform: detailsOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>⌄</span>
          </span>
        </button>
        {detailsOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 16px 14px", borderTop: "1px solid #000", background: "#17171B" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#77757F" }}>Loofta fee ({feePct}%)</span><span>{feeHuman != null && get ? `${fmt(feeHuman, 4)} ${get.symbol}` : "-"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#77757F" }}>Minimum received</span><span>{minHuman != null && get ? `${fmt(minHuman)} ${get.symbol}` : "-"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#77757F" }}>Price impact</span><span style={{ color: impactColor, fontWeight: impactPct != null && impactPct >= IMPACT_WARN_PCT ? 700 : 400 }}>{impactText}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#77757F" }}>Route</span><span>Jupiter</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#77757F" }}>Network fee</span><span>{quote?.gasless ? "Paid by Loofta, taken from your USDC" : "Paid in SOL"}</span></div>
            {quote?.gasless && <span style={{ fontSize: 13, lineHeight: 1.45, color: "#77757F" }}>No SOL needed, and no minimum swap. Loofta pays the network fee and takes it from the USDC you swap.</span>}
          </div>
        )}
      </div>

      {impactPct != null && impactPct >= IMPACT_WARN_PCT && (
        <span style={{ fontSize: 13, lineHeight: 1.45, color: impactPct >= IMPACT_DANGER_PCT ? "#FF7A6A" : "#F5D547", padding: "0 6px" }}>
          {impactBlocked
            ? `This swap would move the price by about ${impactPct.toFixed(1)}%. Try a smaller amount.`
            : impactPct >= IMPACT_DANGER_PCT
              ? `High price impact. You could lose about ${impactPct.toFixed(1)}% of your value on this swap.`
              : `Price impact is ${impactPct.toFixed(1)}%. A smaller amount would get you a better rate.`}
        </span>
      )}
      {isGaslessPair && <span style={{ fontSize: 13, lineHeight: 1.45, color: "#6FD69A", padding: "0 6px" }}>Gasless: no SOL needed for this swap.</span>}
      {lacksSol && <span style={{ fontSize: 13, lineHeight: 1.45, color: "#F5D547", padding: "0 6px" }}>You need about 0.003 SOL for the network fee. Swap some USDC to SOL first, that one is free.</span>}

      <button type="button" onClick={() => void go()} disabled={!ready || busy} style={{ ...BTN_PRIMARY, flex: "none", width: "100%", marginTop: "auto", opacity: !ready || busy ? 0.4 : 1 }}>
        {busy ? "Swapping…" : cta}
      </button>
    </div>
  );
}
