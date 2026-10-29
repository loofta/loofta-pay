"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDown, ExternalLink, Lock } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { useWalletHoldings } from "@/hooks/useWalletHoldings";
import { useToast } from "@/components/ui/use-toast";
import { TokenCombobox } from "@/components/TokenCombobox";
import { WalletTokenLogo } from "@/components/wallet/WalletTokenLogo";
import { useLooftaSigner, saveWithdrawal } from "@/components/deposit/DepositSheet";
import { getAccurateQuote, getDepositInfo } from "@/services/nearIntents";
import { prepareNearIntentsWithdrawal } from "@/services/solanaSponsor";
import { sendUsdcWithBackendFeePayer } from "@/services/privyEmbeddedUsdcSend";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { getPrivySolanaChainForMode, getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";
import { findUsdcOnSolana } from "@/lib/depositRails";
import { findTokenBySelection, formatChainLabel } from "@/lib/tokens";
import { isValidAddressForChain } from "@/lib/refundAddresses";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { tagWalletTx } from "@/lib/walletActivityTags";
import type { TokenSelection } from "@/app/utils/types";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_BOX, FIELD_INPUT, FIELD_PILL } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";
const SOL_RESERVE = 0.01;

type PayAsset = "USDC" | "SOL";

const isSolanaChain = (c?: string) => !!c && ["sol", "solana"].includes(c.toLowerCase());
const isEvmChain = (c?: string) =>
  !!c && ["eth", "ethereum", "base", "arb", "arbitrum", "op", "optimism", "pol", "polygon", "bsc", "bnb", "avax", "avalanche", "gnosis", "xdai", "linea", "scroll", "berachain", "bera"].includes(c.toLowerCase());

const card = { display: "flex", flexDirection: "column", gap: 8, padding: 16, borderRadius: 22, background: "#1A1A20", border: "1px solid rgba(255,255,255,0.07)" } as const;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Cross-chain swap body for the wallet modal. Always confidential, on NEAR Intents. */
export function WalletSwap({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { user, getAccessToken } = usePrivy();
  const { toast } = useToast();
  const tr = useTranslations("Wallet");
  const networkMode = useAuthStore((s) => s.networkMode);
  const devnetMode = networkMode === "devnet";
  const cluster = devnetMode ? "devnet" : "mainnet";
  const { holdings, address: solanaAddress, evmAddress } = useWalletHoldings();
  const { data: tokens = [] } = useTokensQuery();
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);

  const [pay, setPay] = useState<PayAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [selection, setSelection] = useState<TokenSelection | undefined>(undefined);
  const [destination, setDestination] = useState("");
  const [destEdited, setDestEdited] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ sig: string; cross: boolean } | null>(null);

  const usdcToken = findUsdcOnSolana(tokens);
  const solToken = tokens.find((t) => t.symbol.toUpperCase() === "SOL" && isSolanaChain(t.chain));
  const payToken = pay === "USDC" ? usdcToken : solToken;
  const toToken = findTokenBySelection(tokens, selection);
  const payHolding = holdings.find((h) => h.symbol === pay && (pay === "SOL" ? h.mint === null : true));
  const balance = payHolding?.amount ?? 0;
  const amountNum = Number(amount);
  const isCross = true;

  const choices = useMemo(
    () => tokens.filter((t) => isSolanaChain(t.chain) === !isCross && !(payToken && t.tokenId === payToken.tokenId)),
    [tokens, payToken, isCross],
  );
  const maxSendable = Math.max(0, pay === "USDC" ? balance : balance - SOL_RESERVE);
  const over = amountNum > maxSendable + 1e-9;
  const defaultDestination = toToken ? (isSolanaChain(toToken.chain) ? solanaAddress : isEvmChain(toToken.chain) ? evmAddress : null) : null;
  const addressOk = !!toToken && isValidAddressForChain(destination.trim(), toToken.chain);
  const payPrice = payHolding && payHolding.amount > 0 && payHolding.usd != null ? payHolding.usd / payHolding.amount : pay === "USDC" ? 1 : null;

  // Switching tab or pay token invalidates the receive token (it must differ from what you pay and match the tab).
  useEffect(() => {
    setSelection(undefined);
    setDestEdited(false);
    setQuote(null);
  }, [pay]);

  useEffect(() => {
    if (selection || choices.length === 0) return;
    const first = isCross
      ? choices.find((t) => t.symbol.toUpperCase() === "ETH" && t.chain.toLowerCase() === "base") ?? choices.find((t) => t.symbol.toUpperCase() === "ETH") ?? choices[0]
      : choices.find((t) => t.symbol.toUpperCase() === (pay === "USDC" ? "SOL" : "USDC")) ?? choices[0];
    if (first) setSelection({ symbol: first.symbol, chain: first.chain });
  }, [selection, choices, isCross, pay]);

  useEffect(() => {
    if (destEdited) return;
    setDestination(defaultDestination ?? "");
  }, [defaultDestination, destEdited]);

  useEffect(() => {
    setQuote(null);
    if (!payToken || !toToken || !(amountNum > 0)) return;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await getAccurateQuote({ fromToken: payToken, toToken, amount: String(amountNum), slippageBps: 100, dryRun: true });
        if (!cancelled) setQuote(result.amountOut && !result.error ? result.amountOut : null);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payToken, toToken, amountNum]);

  const sendSolToDeposit = async (depositAddress: string, solAmount: number) => {
    if (!wallet || !solanaAddress) throw new Error(tr("cross.walletNotReady"));
    const connection = new Connection(getRpcForMode(cluster), "confirmed");
    const from = new PublicKey(solanaAddress);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(depositAddress), lamports: Math.round(solAmount * 1e9) }),
    );
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = from;
    const { signedTransaction } = await signTransaction({
      transaction: tx.serialize({ requireAllSignatures: false }),
      wallet,
      chain: getPrivySolanaChainForMode(cluster),
    });
    const sig = await connection.sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed" });
    await waitForSignatureConfirmation(connection, sig, 120_000, 1500, "walletSwapSol");
    return sig;
  };

  const go = async () => {
    const userId = user?.id;
    if (!wallet || !userId || !solanaAddress || !payToken || !toToken || !addressOk || !(amountNum > 0) || over) return;
    setBusy(true);
    try {
      const access = await getAccessToken();
      const dest = destination.trim();
      if (pay === "USDC" && isCross) {
        const order = await prepareNearIntentsWithdrawal({ fromToken: payToken, toToken, amountUsdc: String(amountNum), destinationAddress: dest, refundAddress: solanaAddress, isDevnet: devnetMode }, access);
        if (!order.depositAddress || !isValidAddressForChain(order.depositAddress, "solana")) throw new Error(tr("cross.noDeposit"));
        const sig = await sendUsdcWithBackendFeePayer({
          senderAddress: solanaAddress,
          recipientAddress: order.depositAddress,
          amountUSDC: amountNum,
          connection: new Connection(getRpcForMode(cluster), "confirmed"),
          wallet,
          privyUserId: userId,
          signTransaction,
          memo: order.memo ?? undefined,
          usdcMint: getUsdcMintForMode(cluster),
          chain: getPrivySolanaChainForMode(cluster),
          accessToken: access,
          network: cluster,
          nearIntentsOrderId: order.id,
        });
        await saveWithdrawal({ id: sig, amountUSDC: amountNum, txSignature: sig, destinationAddress: dest, destinationChain: toToken.chain, destinationToken: toToken.symbol, isNearIntents: true, depositAddress: order.depositAddress, estimatedOut: quote ?? undefined, nearIntentsStatus: "PENDING", nearIntentsComplete: false }, access, devnetMode);
        tagWalletTx(sig, { kind: "bridge", label: "Cross-chain", private: true });
        setSent({ sig, cross: true });
        onDone?.();
      } else {
        const quoteBase = { fromToken: payToken, toToken, amount: String(amountNum), recipient: dest, sender: solanaAddress, refundAddress: solanaAddress, slippageBps: 100 };
        // 1Click swaps are confidential only (since 27 Oct 2026): ask for the strongest level, fall back to basic.
        const info = await getDepositInfo({ ...quoteBase, confidentiality: "advanced" }).catch(() => getDepositInfo({ ...quoteBase, confidentiality: "basic" }));
        if (!info.depositAddress || !isValidAddressForChain(info.depositAddress, "solana")) throw new Error(tr("cross.noDeposit"));
        let sig: string;
        if (pay === "SOL") {
          sig = await sendSolToDeposit(info.depositAddress, amountNum);
        } else {
          sig = await sendUsdcWithBackendFeePayer({
            senderAddress: solanaAddress,
            recipientAddress: info.depositAddress,
            amountUSDC: amountNum,
            connection: new Connection(getRpcForMode(cluster), "confirmed"),
            wallet,
            privyUserId: userId,
            signTransaction,
            memo: info.memo ?? undefined,
            usdcMint: getUsdcMintForMode(cluster),
            chain: getPrivySolanaChainForMode(cluster),
            accessToken: access,
            network: cluster,
          });
        }
        tagWalletTx(sig, { kind: "bridge", label: "Cross-chain", private: true });
        setSent({ sig, cross: isCross });
        onDone?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr("swap.failed");
      if (msg !== "CANCELLED_BY_USER" && !/reject|cancel|denied/i.test(msg)) {
        toast({ variant: "destructive", title: tr("swap.failed"), description: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  const quoteNum = quote ? Number(quote) : null;
  const rate = quoteNum && amountNum > 0 ? quoteNum / amountNum : null;
  let cta = isCross ? tr("cross.bridge") : tr("common.swap");
  if (over) cta = tr("swap.ctaNotEnough", { symbol: pay });
  else if (isCross && toToken && destination.trim() && !addressOk) cta = tr("cross.checkAddress", { chain: formatChainLabel(toToken.chain) });
  else if (isCross && toToken && !destination.trim() && amountNum > 0) cta = tr("cross.addAddress", { chain: formatChainLabel(toToken.chain) });
  const ready = !!wallet && !!toToken && addressOk && amountNum > 0 && !over;

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setDestination(text.trim());
        setDestEdited(true);
      }
    } catch {
      /* clipboard blocked */
    }
  };

  if (sent) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 12 }}>
        <div style={{ width: 84, height: 84, borderRadius: 28, background: "radial-gradient(120% 120% at 28% 18%,#B8F5D0 0%,#3CB371 48%,#23864F 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #17603A,0 24px 40px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontSize: 40, color: "#fff", fontWeight: 800 }}>✓</div>
        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{sent.cross ? tr("cross.started") : tr("cross.swapSent")}</span>
        <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", maxWidth: 320 }}>
          {toToken ? tr("cross.arrive", { symbol: toToken.symbol, chain: formatChainLabel(toToken.chain) }) : tr("cross.arriveGeneric")}
        </span>
        <a href={getExplorerTxUrl("solana", sent.sig)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#9CC8FF" }}>
          <ExternalLink size={16} /> {tr("common.viewTransaction")}
        </a>
        <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%", marginTop: "auto" }}>{tr("common.done")}</button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: "#77757F" }}>
          <span>{tr("swap.youPay")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{tr("cross.balance", { amount: balance.toLocaleString("en-US", { maximumFractionDigits: pay === "USDC" ? 2 : 4 }), symbol: pay })}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label={tr("swap.amountToPay")} style={{ flex: 1, minWidth: 0, height: 44, background: "transparent", border: 0, outline: "none", color: "#F2EFE8", fontFamily: SORA, fontWeight: 600, fontSize: 24 }} />
          <div role="group" aria-label={tr("cross.payWith")} style={{ flex: "none", display: "flex", gap: 4, padding: 4, borderRadius: 999, background: "#26262E" }}>
            {(["USDC", "SOL"] as PayAsset[]).map((a) => (
              <button key={a} type="button" onClick={() => { setPay(a); setAmount(""); }} aria-pressed={pay === a} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 999, border: 0, background: pay === a ? "#3A3A46" : "transparent", color: "#F2EFE8", fontWeight: 700, fontSize: 14 }}>
                <WalletTokenLogo symbol={a} chain="Solana" size={24} />
                {a}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#77757F" }}>
          <span>{payPrice != null && amountNum > 0 ? `≈ ${money(amountNum * payPrice)}` : ""}</span>
          <button type="button" onClick={() => setAmount(maxSendable > 0 ? String(Number(maxSendable.toFixed(pay === "USDC" ? 2 : 6))) : "")} style={{ ...FIELD_PILL, height: 28, fontSize: 13, padding: "0 12px" }}>{tr("common.max")}</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "-22px 0", position: "relative", zIndex: 1 }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, background: "radial-gradient(120% 120% at 28% 18%,#9CC8FF 0%,#2775CA 48%,#1A55A0 100%)", boxShadow: "inset 0 3px 6px rgba(255,255,255,0.45),0 4px 0 #123E78", border: "4px solid #121216", display: "grid", placeItems: "center" }}>
          <ArrowDown size={18} color="#fff" />
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#77757F" }}>
          <span>{tr("swap.youGet")}</span>
          <span>{toToken ? tr("cross.on", { chain: formatChainLabel(toToken.chain) }) : isCross ? tr("cross.pickToken") : tr("swap.onSolana")}</span>
        </div>
        <span style={{ minHeight: 44, display: "flex", alignItems: "center", fontFamily: SORA, fontWeight: 600, fontSize: 24, color: quote ? "#F2EFE8" : "#5D5B66", overflow: "hidden", textOverflow: "ellipsis" }}>
          {quoting ? "…" : quote ?? "0"}
        </span>
        <TokenCombobox tokens={choices} value={selection} defaultShowAllChains searchPlaceholder={isCross ? tr("cross.searchCross") : tr("cross.searchSolana")} placeholder={tr("cross.searchToken")} onChange={(next) => { setSelection(next); setDestEdited(false); }} />
      </div>

      {isCross && (
        <>
          <div style={FIELD_BOX}>
            <input value={destination} onChange={(e) => { setDestination(e.target.value); setDestEdited(true); }} placeholder={toToken ? tr("cross.addrPlaceholder", { chain: formatChainLabel(toToken.chain) }) : tr("cross.destPlaceholder")} aria-label={tr("cross.destPlaceholder")} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ ...FIELD_INPUT, fontFamily: MONO, fontSize: 14 }} />
            <button type="button" onClick={() => void paste()} style={FIELD_PILL}>{tr("common.paste")}</button>
          </div>
          {defaultDestination && destination === defaultDestination && (
            <span style={{ fontSize: 13, color: "#77757F", padding: "0 6px" }}>{tr("cross.defaultHint", { network: isEvmChain(toToken?.chain) ? "EVM" : "Solana" })}</span>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 18, background: "#0E0E12", fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ color: "#77757F" }}>{tr("cross.rate")}</span>
          <span style={{ textAlign: "right" }}>{rate && toToken ? `1 ${pay} = ${rate.toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${toToken.symbol}` : "-"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#77757F" }}>{tr("swap.route")}</span><span>{tr("cross.routeValue")}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#77757F" }}>{tr("common.networkFee")}</span><span>{pay === "SOL" ? tr("swap.feePaidSol") : tr("common.covered")}</span></div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 18, background: "rgba(255,90,26,0.08)", border: "1px solid rgba(255,122,42,0.35)" }}>
        <Lock size={20} color="#FF8A4A" />
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{tr("cross.confTitle")}</span>
          <span style={{ fontSize: 13, color: "#9A98A3" }}>{tr("cross.confBody")}</span>
        </span>
      </div>

      <button type="button" onClick={() => void go()} disabled={!ready || busy} style={{ ...BTN_PRIMARY, flex: "none", width: "100%", marginTop: "auto", opacity: !ready || busy ? 0.4 : 1 }}>
        {busy ? tr("common.swapping") : cta}
      </button>
    </div>
  );
}
