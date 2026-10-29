"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { usePrivy } from "@privy-io/react-auth";
import { ExternalLink, Lock, Search } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/store/auth";
import { useSolDomain } from "@/hooks/useSolDomain";
import { useSolPriceOrNull } from "@/hooks/useSolPrice";
import { isSolDomain } from "@/lib/refundAddresses";
import { usePerPrivateSelfTransfer } from "@/hooks/usePerPrivateSelfTransfer";
import { usePerPrivateTokenWithdrawal } from "@/hooks/usePerPrivateTokenWithdrawal";
import type { WalletHolding } from "@/hooks/useWalletHoldings";
import { useLooftaSigner } from "@/components/deposit/DepositSheet";
import { WalletModal } from "@/components/wallet/WalletModal";
import { WalletTokenLogo } from "@/components/wallet/WalletTokenLogo";
import { privyStandardWalletToAnchorWallet } from "@/lib/per/signer";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { getPrivySolanaChainForMode, getRpcForMode } from "@/lib/solanaRpc";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { tagWalletTx } from "@/lib/walletActivityTags";
import { PrivacyTimingControls } from "@/components/app/PrivacyTimingControls";
import { DEFAULT_SPREAD_MS, DELAY_UNIT_MS, randomPrivacySplit } from "@/lib/privacyDelay";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_BOX, FIELD_INPUT, FIELD_PILL, shortAddress as shortAddr } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MIN_SOL_FOR_FEES = 0.003;
/** Private SOL: MagicBlock wraps and unwraps it. Keep SOL back for the wrap account rent, relay gas and buffer. */
const PRIVATE_SOL_RESERVE = 0.005;
/** The 0.2% privacy fee (MagicBlock 10 bps + Loofta 10 bps) is charged on top of the amount. */
const PRIVATE_FEE_FACTOR = 1.002;
/** A plain SOL transfer only costs the network fee. */
const PUBLIC_SOL_FEE = 0.00002;
/** Private USDC is gasless: MagicBlock's SOL charge (0.002 SOL, never under $0.20) is taken from the USDC, with a 5% cushion. */
const usdcRelayFee = (solPrice: number | null) => Math.max((solPrice ?? 0) * 0.002, 0.2) * 1.05;

type Step = "form" | "pick" | "review" | "done";
type Kind = "empty" | "solana" | "domain" | "evm" | "invalid";

function classify(raw: string): Kind {
  const v = raw.trim();
  if (!v) return "empty";
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return "evm";
  if (isSolDomain(v.toLowerCase())) return "domain";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
    try {
      new PublicKey(v);
      return "solana";
    } catch {
      return "invalid";
    }
  }
  return "invalid";
}

function trimAmount(n: number, decimals: number): string {
  return n > 0 ? n.toFixed(Math.min(decimals, 9)).replace(/\.?0+$/, "") : "";
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function WalletSendModal({
  open,
  onClose,
  holdings,
  solanaAddress,
  onUseSwap,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  holdings: WalletHolding[];
  solanaAddress: string | null;
  onUseSwap: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const tr = useTranslations("Wallet");
  const delayText = (ms: number) => {
    if (ms <= 0) return tr("delay.none");
    if (ms < DELAY_UNIT_MS.hours) return tr("delay.minutes", { n: Math.round(ms / DELAY_UNIT_MS.minutes) });
    if (ms < DELAY_UNIT_MS.days) return tr("delay.hours", { n: Math.round(ms / DELAY_UNIT_MS.hours) });
    return tr("delay.days", { n: Math.round(ms / DELAY_UNIT_MS.days) });
  };
  const { user, getAccessToken } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const cluster = networkMode === "devnet" ? "devnet" : "mainnet";
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);
  const { withdraw: withdrawUsdcPrivately } = usePerPrivateSelfTransfer();
  const { send: sendTokenPrivately } = usePerPrivateTokenWithdrawal();

  const sendable = holdings.filter((h) => h.amount > 0);
  const [step, setStep] = useState<Step>("form");
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [privately, setPrivately] = useState(false);
  const [split, setSplit] = useState<number>(() => randomPrivacySplit());
  const [delayMs, setDelayMs] = useState<number>(DEFAULT_SPREAD_MS);
  const [timingInfoOpen, setTimingInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feeNote, setFeeNote] = useState<string | null>(null);
  const [sent, setSent] = useState<{ sig: string; private: boolean } | null>(null);
  const confirmRef = useRef<null | { resolve: () => void; reject: (e: Error) => void }>(null);

  useEffect(() => {
    if (!open) {
      setStep("form");
      setQuery("");
      setSelId("");
      setRecipient("");
      setAmount("");
      setPrivately(false);
      setFeeNote(null);
      setSent(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && !selId && sendable.length > 0) setSelId(sendable[0].id);
  }, [open, selId, sendable]);

  const token = sendable.find((h) => h.id === selId);
  const kind = classify(recipient);
  const domain = useSolDomain(recipient, networkMode);
  const resolved = kind === "domain" && domain.status === "resolved" ? domain.address : null;
  /** The wallet the tokens actually go to: the typed address, or what the .sol name points at. */
  const destAddress = kind === "solana" ? recipient.trim() : resolved;
  const amountNum = Number(amount);
  const solPrice = useSolPriceOrNull();
  const solHeld = holdings.find((h) => h.mint === null)?.amount ?? 0;
  const isUsdc = token?.mint === MAINNET_USDC;
  const canPrivate = !!token && cluster === "mainnet";
  const isSol = token?.mint === null;
  const usePrivate = privately && canPrivate;
  // Max is the balance minus what the send itself costs: the network fee, plus for private sends the wrap
  // account rent, MagicBlock's SOL charge and the 0.2% privacy fee on top of the amount.
  const reserve = isSol ? (usePrivate ? PRIVATE_SOL_RESERVE : PUBLIC_SOL_FEE) : 0;
  const maxAmount = token
    ? Math.max(0, usePrivate && isUsdc ? (token.amount - usdcRelayFee(solPrice)) / PRIVATE_FEE_FACTOR : (token.amount - reserve) / (usePrivate ? PRIVATE_FEE_FACTOR : 1))
    : 0;
  const over = amountNum > maxAmount + 1e-12;
  const needsSolForFees = !isSol && !(usePrivate && isUsdc) && solHeld < MIN_SOL_FOR_FEES;
  const usdValue = token && token.usd != null && token.amount > 0 ? (token.usd / token.amount) * (amountNum || 0) : null;
  const canNext = !!token && !!destAddress && amountNum > 0 && !over && !needsSolForFees;
  const filtered = sendable.filter((h) => `${h.name} ${h.symbol}`.toLowerCase().includes(query.trim().toLowerCase()));

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRecipient(text.replace(/\s/g, ""));
    } catch {
      /* clipboard blocked */
    }
  };

  const sendPublic = async () => {
    if (!wallet || !token || !solanaAddress || !destAddress) return;
    const connection = new Connection(getRpcForMode(cluster), "confirmed");
    const from = new PublicKey(solanaAddress);
    const to = new PublicKey(destAddress as string);
    const units = BigInt(Math.round(amountNum * 10 ** token.decimals));
    const tx = new Transaction();
    if (token.mint === null) {
      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Number(units) }));
    } else {
      const mint = new PublicKey(token.mint);
      const fromAta = getAssociatedTokenAddressSync(mint, from);
      const toAta = getAssociatedTokenAddressSync(mint, to, true);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint));
      tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, from, units, token.decimals));
    }
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = from;
    const { signedTransaction } = await signTransaction({
      transaction: tx.serialize({ requireAllSignatures: false }),
      wallet,
      chain: getPrivySolanaChainForMode(cluster),
    });
    const sig = await connection.sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed" });
    await waitForSignatureConfirmation(connection, sig, 120_000, 1500, "walletSend");
    return sig;
  };

  const go = async () => {
    const userId = user?.id;
    if (!canNext || !wallet || !token || !userId || !destAddress) return;
    setBusy(true);
    try {
      const dest = destAddress as string;
      if (usePrivate) {
        const access = await getAccessToken();
        const anchor = privyStandardWalletToAnchorWallet(wallet, signTransaction, getPrivySolanaChainForMode(cluster));
        const confirmFee = (text: string) =>
          new Promise<void>((resolve, reject) => {
            setFeeNote(text);
            setBusy(false);
            confirmRef.current = { resolve, reject };
          });
        if (isUsdc) {
          const r = await withdrawUsdcPrivately(anchor, {
            privyUserId: userId,
            accessToken: access,
            amountUsdc: amountNum,
            destinationAddress: dest,
            split,
            maxDelayMs: delayMs,
            onTxBuilt: ({ feeAmountUsdc }) => confirmFee(tr("send.feeNoteUsdc", { fee: feeAmountUsdc.toFixed(2), amount: amountNum })),
          });
          tagWalletTx(r.signature, { private: true, kind: "send", to: dest });
          setSent({ sig: r.signature, private: true });
        } else {
          const privateMint = isSol ? NATIVE_MINT.toBase58() : (token.mint as string);
          const r = await sendTokenPrivately(anchor, {
            privyUserId: userId,
            accessToken: access,
            mint: privateMint,
            amount: String(amountNum),
            destinationAddress: dest,
            split,
            maxDelayMs: delayMs,
            onTxBuilt: (b) =>
              confirmFee(tr("send.feeNoteToken", { feeToken: b.feeAmountToken.toFixed(Math.min(token.decimals, 6)), symbol: token.symbol, feeUsd: b.feeAmountUsd.toFixed(2), networkSol: b.networkFeeSol, amount: amountNum })),
          });
          tagWalletTx(r.signature, { private: true, kind: "send", to: dest });
          setSent({ sig: r.signature, private: true });
        }
      } else {
        const sig = await sendPublic();
        if (sig) setSent({ sig, private: false });
      }
      setStep("done");
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr("send.failed");
      if (msg !== "CANCELLED_BY_USER" && !/reject|cancel|denied/i.test(msg)) {
        toast({ variant: "destructive", title: tr("send.failed"), description: msg });
      }
      setStep("form");
    } finally {
      setBusy(false);
    }
  };

  const title = step === "pick" ? tr("send.chooseToken") : step === "review" ? tr("send.review") : step === "done" ? tr("send.sent") : tr("send.title", { symbol: token?.symbol ?? "" }).trim();
  const onBack = step === "pick" ? () => setStep("form") : step === "review" && !busy && !feeNote ? () => setStep("form") : null;
  const row = { display: "flex", justifyContent: "space-between", gap: 16 } as const;
  const feeBox = { padding: "14px 16px", borderRadius: 18, background: "#0E0E12", display: "flex", flexDirection: "column", gap: 8, fontSize: 14 } as const;

  const feeText = (amount: number, symbol: string, decimals: number) => tr("send.feeAboutToken", { amount: amount < 0.01 ? trimAmount(amount, Math.min(decimals, 6)) : amount.toFixed(2), symbol });
  const hasAmount = amountNum > 0;
  const privacyCost = hasAmount ? amountNum * (PRIVATE_FEE_FACTOR - 1) : 0;
  const relayCost = usdcRelayFee(solPrice);
  const networkFee = usePrivate ? (isUsdc ? feeText(relayCost, "USDC", 6) : tr("send.feeAbout", { amount: "0.002" })) : tr("send.feeAbout", { amount: "0.000005" });
  const privacyFee = hasAmount && token ? feeText(privacyCost, token.symbol, token.decimals) : tr("send.privacyFeePct");
  const totalUsdcFee = usePrivate && isUsdc && hasAmount ? feeText(relayCost + privacyCost, "USDC", 6) : null;

  return (
    <WalletModal open={open} onClose={onClose} title={title} onBack={onBack}>
      {step === "pick" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={FIELD_BOX}>
            <Search size={20} color="#9A98A3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("common.search")} aria-label={tr("common.searchTokens")} style={FIELD_INPUT} />
          </label>
          {filtered.map((h) => (
            <button key={h.id} type="button" onClick={() => { setSelId(h.id); setAmount(""); setStep("form"); }} className="lh-9" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, textAlign: "left", background: "#1A1A20", border: "1px solid rgba(255,255,255,0.06)", color: "#F2EFE8" }}>
              <WalletTokenLogo symbol={h.symbol} chain={h.chain} logo={h.logo} mint={h.mint} size={40} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ fontSize: 14, color: "#77757F" }}>{h.amount.toLocaleString("en-US", { maximumFractionDigits: h.decimals > 4 ? 5 : 2 })} {h.symbol}</span>
              </span>
              {h.usd != null && <span style={{ fontWeight: 700, fontSize: 15 }}>{money(h.usd)}</span>}
            </button>
          ))}
          {filtered.length === 0 && <span style={{ fontSize: 15, color: "#9A98A3", padding: "8px 4px" }}>{sendable.length === 0 ? tr("send.nothingToSend") : tr("send.noTokenMatch")}</span>}
        </div>
      )}

      {step === "form" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {!token ? (
            <span style={{ fontSize: 15, color: "#9A98A3", padding: "8px 4px" }}>{tr("send.nothingToSendReceive")}</span>
          ) : (
            <>
              <button type="button" onClick={() => setStep("pick")} className="lh-9" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 20, background: "#1A1A20", border: "1px solid rgba(255,255,255,0.07)", color: "#F2EFE8", textAlign: "left" }}>
                <WalletTokenLogo symbol={token.symbol} chain={token.chain} logo={token.logo} mint={token.mint} size={38} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{token.name}</span>
                  <span style={{ fontSize: 13, color: "#77757F" }}>{tr("common.available", { amount: token.amount.toLocaleString("en-US", { maximumFractionDigits: 6 }), symbol: token.symbol })}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#9A98A3" }}>{tr("send.change")}</span>
              </button>

              <div style={FIELD_BOX}>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/\s/g, ""))} placeholder={tr("send.recipientPlaceholder")} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={tr("send.recipientAria")} style={{ ...FIELD_INPUT, fontFamily: recipient ? MONO : undefined }} />
                <button type="button" onClick={() => void paste()} style={FIELD_PILL}>{tr("common.paste")}</button>
              </div>
              {kind === "empty" && (
                <span style={{ fontSize: 13, color: "#77757F", padding: "0 6px", lineHeight: 1.45 }}>
                  {tr.rich("send.recipientHint", {
                    link: (chunks) => (
                      <button type="button" onClick={() => { onClose(); router.push("/app/send"); }} style={{ cursor: "pointer", background: "none", border: 0, padding: 0, color: "#9CC8FF", fontWeight: 700, fontSize: 13 }}>{chunks}</button>
                    ),
                  })}
                </span>
              )}
              {kind === "domain" && domain.status === "resolving" && <span style={{ fontSize: 14, color: "#77757F", padding: "0 6px" }}>{tr("send.lookingUp", { name: recipient.trim() })}</span>}
              {kind === "domain" && resolved && <span style={{ fontSize: 14, color: "#6FD69A", padding: "0 6px" }}>{recipient.trim()} → <span style={{ fontFamily: MONO }}>{shortAddr(resolved)}</span></span>}
              {kind === "domain" && domain.status === "not-found" && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>{tr("send.noWalletFor", { name: recipient.trim() })}</span>}
              {kind === "domain" && domain.status === "error" && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>{tr("send.lookupError")}</span>}
              {kind === "invalid" && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>{tr("send.invalidRecipient")}</span>}
              {kind === "evm" && (
                <button type="button" onClick={() => { onClose(); onUseSwap(); }} className="lh-9" style={{ cursor: "pointer", textAlign: "left", padding: 14, borderRadius: 18, background: "#1A1A20", border: "1px solid rgba(255,255,255,0.1)", color: "#F2EFE8", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{tr("send.evmTitle")}</span>
                    <span style={{ fontSize: 14, color: "#9A98A3" }}>{tr("send.evmSub")}</span>
                  </span>
                  <span style={{ fontSize: 20, color: "#5D5B66" }}>→</span>
                </button>
              )}

              <div style={FIELD_BOX}>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={tr("common.amount")} aria-label={tr("common.amount")} style={FIELD_INPUT} />
                <span style={{ fontSize: 15, color: "#9A98A3", fontWeight: 700 }}>{token.symbol}</span>
                <button type="button" onClick={() => setAmount(trimAmount(maxAmount, token.decimals))} style={FIELD_PILL}>{tr("common.max")}</button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "0 6px", fontSize: 14, color: over ? "#FF7A6A" : "#77757F" }}>
                <span>{usdValue != null ? `≈ ${money(usdValue)}` : ""}</span>
                <span>{over ? tr("send.over") : tr("common.available", { amount: token.amount.toLocaleString("en-US", { maximumFractionDigits: 6 }), symbol: token.symbol })}</span>
              </div>
              {needsSolForFees && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>{tr("send.needSol", { amount: MIN_SOL_FOR_FEES })}</span>}

              <button type="button" role="switch" aria-checked={usePrivate} aria-label={tr("send.privately")} disabled={!canPrivate} onClick={() => setPrivately((v) => !v)} style={{ cursor: canPrivate ? "pointer" : "default", textAlign: "left", display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, background: usePrivate ? "rgba(255,90,26,0.08)" : "#1A1A20", border: `1px solid ${usePrivate ? "rgba(255,122,42,0.35)" : "rgba(255,255,255,0.07)"}`, color: "#F2EFE8", opacity: canPrivate ? 1 : 0.6 }}>
                <span style={{ flex: "none", width: 40, height: 40, borderRadius: 13, background: usePrivate ? "linear-gradient(135deg,#FF5A1A,#F5A20C)" : "#2A2A32", display: "grid", placeItems: "center" }}>
                  <Lock size={20} color="#fff" />
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{tr("send.privately")}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: "#9A98A3" }}>
                    {canPrivate ? tr("send.privateOn") : tr("send.privateMainnet")}
                  </span>
                </span>
                <span style={{ flex: "none", width: 48, height: 28, borderRadius: 999, background: usePrivate ? "linear-gradient(90deg,#FF2D0A,#F5B70C)" : "#2A2A32", padding: 3, boxSizing: "border-box", display: "flex", justifyContent: usePrivate ? "flex-end" : "flex-start" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff" }} />
                </span>
              </button>

              {usePrivate && (
                <PrivacyTimingControls idPrefix="wallet-send" split={split} onSplitChange={setSplit} delayMs={delayMs} onDelayMsChange={setDelayMs} amountUsd={usdValue ?? undefined} infoOpen={timingInfoOpen} onInfoOpenChange={setTimingInfoOpen} />
              )}

              <div style={feeBox}>
                <div style={row}><span style={{ color: "#77757F" }}>{tr("common.networkFee")}</span><span>{networkFee}</span></div>
                {usePrivate && <div style={row}><span style={{ color: "#77757F" }}>{tr("send.privacyFee")}</span><span>{privacyFee}</span></div>}
                {totalUsdcFee && <div style={row}><span style={{ color: "#77757F" }}>{tr("send.totalFee")}</span><span style={{ fontWeight: 700 }}>{totalUsdcFee}</span></div>}
                <div style={row}><span style={{ color: "#77757F" }}>{tr("send.arrives")}</span><span>{usePrivate ? delayText(delayMs) : tr("common.instant")}</span></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto", paddingTop: 4 }}>
                <button type="button" onClick={onClose} style={BTN_SECONDARY}>{tr("common.cancel")}</button>
                <button type="button" onClick={() => setStep("review")} disabled={!canNext} style={{ ...BTN_PRIMARY, opacity: canNext ? 1 : 0.4 }}>{tr("send.review")}</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "review" && token && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "4px 0 2px" }}>
            <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 34, letterSpacing: "-0.04em", textAlign: "center" }}>{amountNum} {token.symbol}</span>
            {usdValue != null && <span style={{ fontSize: 15, color: "#77757F" }}>≈ {money(usdValue)}</span>}
          </div>
          <div style={{ ...feeBox, padding: 16, gap: 10 }}>
            <div style={row}><span style={{ color: "#77757F" }}>{tr("send.to")}</span><span style={{ fontFamily: MONO }}>{kind === "domain" ? `${recipient.trim()} (${shortAddr(destAddress ?? "")})` : shortAddr(destAddress ?? "")}</span></div>
            <div style={row}><span style={{ color: "#77757F" }}>{tr("send.mode")}</span><span style={{ fontWeight: 700, color: usePrivate ? "#FF8A4A" : "#F2EFE8" }}>{usePrivate ? tr("send.modePrivate") : tr("send.modePublic")}</span></div>
            <div style={row}><span style={{ color: "#77757F" }}>{tr("common.networkFee")}</span><span>{networkFee}</span></div>
            {usePrivate && <div style={row}><span style={{ color: "#77757F" }}>{tr("send.privacyFee")}</span><span>{privacyFee}</span></div>}
            {totalUsdcFee && <div style={row}><span style={{ color: "#77757F" }}>{tr("send.totalFee")}</span><span style={{ fontWeight: 700 }}>{totalUsdcFee}</span></div>}
            <div style={row}><span style={{ color: "#77757F" }}>{tr("send.arrives")}</span><span>{usePrivate ? delayText(delayMs) : tr("common.instant")}</span></div>
          </div>
          {usePrivate && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: "#77757F" }}>{tr("send.route")}</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
            </div>
          )}
          {feeNote && (
            <div style={{ padding: 16, borderRadius: 18, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: "#C8C6D0" }}>{feeNote}</span>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => { setFeeNote(null); confirmRef.current?.reject(new Error("CANCELLED_BY_USER")); confirmRef.current = null; }} style={{ ...BTN_SECONDARY, height: 48, fontSize: 15 }}>{tr("common.cancel")}</button>
                <button type="button" onClick={() => { setFeeNote(null); setBusy(true); confirmRef.current?.resolve(); confirmRef.current = null; }} style={{ ...BTN_PRIMARY, height: 48, fontSize: 15 }}>{tr("common.confirm")}</button>
              </div>
            </div>
          )}
          {!feeNote && (
            <button type="button" onClick={() => void go()} disabled={busy} style={{ ...BTN_PRIMARY, flex: "none", width: "100%", marginTop: "auto", opacity: busy ? 0.6 : 1 }}>
              {busy ? tr("common.sending") : tr("send.sendNow")}
            </button>
          )}
        </div>
      )}

      {step === "done" && sent && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 12 }}>
          <div style={{ width: 84, height: 84, borderRadius: 28, background: "radial-gradient(120% 120% at 28% 18%,#B8F5D0 0%,#3CB371 48%,#23864F 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #17603A,0 24px 40px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontSize: 40, color: "#fff", fontWeight: 800 }}>✓</div>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{sent.private ? tr("send.donePrivateTitle") : tr("send.sent")}</span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", maxWidth: 320 }}>
            {sent.private ? tr("send.donePrivateBody", { split, duration: delayText(delayMs) }) : tr("send.donePublicBody")}
          </span>
          <a href={getExplorerTxUrl("solana", sent.sig)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#9CC8FF" }}>
            <ExternalLink size={16} /> {tr("common.viewTransaction")}
          </a>
          <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%", marginTop: "auto" }}>{tr("common.done")}</button>
        </div>
      )}
    </WalletModal>
  );
}
