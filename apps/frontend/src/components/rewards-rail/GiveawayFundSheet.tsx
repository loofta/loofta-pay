"use client";

import { useEffect, useState } from "react";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { DepositSheet, type DepositLaunch } from "@/components/deposit/DepositSheet";
import { findUsdcOnBase, findUsdcOnSolana } from "@/lib/depositRails";
import { getAccurateQuote, type NearToken } from "@/services/nearIntents";
import { totalWithMagicBlockPrivateFee } from "@/services/magicblockPrivateTransfer";
import { sora, manrope } from "@/components/home-v4/fonts";

const PAJ = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";

type MethodId = "solana" | "solana-private" | "chain" | "moonpay" | "coinbase" | "paj" | "revolut" | "venmo" | "cashapp";

const METHODS: { id: MethodId; title: string; hint: string }[] = [
  { id: "solana", title: "USDC on Solana", hint: "No extra fee" },
  { id: "solana-private", title: "USDC on Solana, privately", hint: "MagicBlock relay, 0.10% + $0.20" },
  { id: "chain", title: "Another chain", hint: "SOL, BTC, ETH, and more. Bridge fee included." },
  { id: "moonpay", title: "MoonPay", hint: "Card, Apple Pay, or Google Pay" },
  { id: "coinbase", title: "Coinbase", hint: "Coinbase adds its fee in the checkout" },
  ...(PAJ ? [{ id: "paj" as const, title: "PAJ Cash", hint: "Naira transfer. Their quote includes the fee." }] : []),
  { id: "revolut", title: "Revolut", hint: "Bridge fee included" },
  { id: "venmo", title: "Venmo", hint: "Bridge fee included" },
  { id: "cashapp", title: "Cash App", hint: "Bridge fee included" },
];

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function findSol(tokens: NearToken[]): NearToken | undefined {
  return tokens.find((t) => t.symbol.toUpperCase() === "SOL" && (t.chain === "sol" || t.chain === "solana"));
}

export function GiveawayFundSheet({
  open,
  onClose,
  prizeUsd,
  platformFeeUsd,
  balanceUsd,
  solanaAddress,
  devnetMode,
}: {
  open: boolean;
  onClose: () => void;
  prizeUsd: number;
  platformFeeUsd: number;
  balanceUsd: number;
  solanaAddress: string | null;
  devnetMode: boolean;
}) {
  const { data: tokens = [] } = useTokensQuery();
  const [method, setMethod] = useState<MethodId>("solana");
  const [bridgeFee, setBridgeFee] = useState<number | null>(null);
  const [chainSend, setChainSend] = useState<string>("");
  const [moonpayFee, setMoonpayFee] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<DepositLaunch | null>(null);

  const target = prizeUsd + platformFeeUsd;
  const shortfall = Math.max(0, Math.round((target - balanceUsd) * 100) / 100);
  const needsBridge = method === "chain" || method === "revolut" || method === "venmo" || method === "cashapp";

  useEffect(() => {
    if (!open || shortfall <= 0 || !needsBridge || !solanaAddress) {
      setBridgeFee(null);
      setChainSend("");
      return;
    }
    const from = method === "chain" ? findSol(tokens) : findUsdcOnBase(tokens);
    const to = findUsdcOnSolana(tokens);
    if (!from || !to) return;
    let cancel = false;
    setBridgeFee(null);
    getAccurateQuote({
      fromToken: from,
      toToken: to,
      amount: String(shortfall),
      recipient: solanaAddress,
      swapType: "EXACT_OUTPUT",
      dryRun: true,
    }).then((quote) => {
      if (cancel) return;
      const send = Number(quote.amountIn);
      if (!(send > 0)) { setBridgeFee(null); return; }
      if (method === "chain") {
        const px = from.price && from.price > 0 ? from.price : 0;
        setChainSend(String(send));
        setBridgeFee(px > 0 ? Math.max(0, send * px - shortfall) : null);
      } else {
        setBridgeFee(Math.max(0, send - shortfall));
        setChainSend(String(send));
      }
    }).catch(() => { if (!cancel) setBridgeFee(null); });
    return () => { cancel = true; };
  }, [open, shortfall, needsBridge, method, solanaAddress, tokens]);

  useEffect(() => {
    if (!open || method !== "moonpay" || shortfall <= 0) { setMoonpayFee(null); return; }
    let cancel = false;
    fetch(`/api/giveaways/moonpay-quote?usdc=${encodeURIComponent(String(shortfall))}`)
      .then((r) => r.json())
      .then((body: { fee?: number | null }) => { if (!cancel) setMoonpayFee(typeof body.fee === "number" ? body.fee : null); })
      .catch(() => { if (!cancel) setMoonpayFee(null); });
    return () => { cancel = true; };
  }, [open, method, shortfall]);

  const methodFee = method === "solana" || method === "coinbase" || method === "paj"
    ? 0
    : method === "solana-private"
      ? totalWithMagicBlockPrivateFee(shortfall) - shortfall
      : method === "moonpay"
        ? moonpayFee
        : bridgeFee;
  const payTotal = methodFee == null ? null : shortfall + methodFee;
  const feePending = shortfall > 0 && needsBridge && !chainSend;

  const start = () => {
    if (!solanaAddress || shortfall <= 0) return;
    if (method === "solana" || method === "solana-private") {
      setDeposit({ screen: "solana", amount: String(shortfall), privately: method === "solana-private", lockAmount: true });
      return;
    }
    if (method === "chain") {
      if (!chainSend) return;
      setDeposit({ screen: "address", amount: chainSend, privately: false, lockAmount: true });
      return;
    }
    if (method === "paj") {
      setDeposit({ screen: "paj", amount: String(shortfall), lockAmount: true });
      return;
    }
    const card = method === "moonpay" || method === "coinbase" || method === "revolut" || method === "venmo" || method === "cashapp" ? method : "moonpay";
    const send = method === "moonpay" || method === "coinbase" ? String(shortfall) : (chainSend || String(shortfall));
    setDeposit({
      screen: "card",
      amount: send,
      card,
      lockAmount: true,
      receiveExactly: method === "moonpay",
    });
  };

  if (!open) return null;

  return (
    <>
      <div className={`${sora.variable} ${manrope.variable} fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-md`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
        <div className="max-h-[calc(100vh-32px)] w-full max-w-[480px] overflow-auto rounded-[30px] border border-white/10 bg-[#121217] p-6 text-[#F2EFE8] shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-[22px] font-bold" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>Fund your wallet</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-xl bg-[#1E1E25] text-[#9A98A3]">×</button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#9A98A3]">
            This tops up your Loofta balance first. The prize and the platform fee have to be in the wallet before the giveaway can be paid from it.
          </p>
          <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0E0E12] p-4 text-sm">
            <Row label="Prize" value={money(prizeUsd)} />
            <Row label="Platform fee" value={money(platformFeeUsd)} />
            <Row label="Needed in your wallet" value={money(target)} />
            <Row label="Already there" value={money(balanceUsd)} />
            <Row label="Method fee" value={shortfall <= 0 ? money(0) : method === "coinbase" || method === "paj" ? "At checkout" : methodFee == null ? "…" : money(methodFee)} />
            <div className="my-1 h-px bg-white/10" />
            <div className="flex items-baseline justify-between">
              <span className="font-bold">You pay</span>
              <span className="text-2xl font-bold" style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}>
                {shortfall <= 0 ? money(0) : payTotal == null ? "…" : money(payTotal)}
              </span>
            </div>
            {method === "coinbase" && shortfall > 0 && (
              <p className="text-sm text-[#8A8893]">Coinbase adds its own card fee on top of {money(shortfall)} USDC in their window.</p>
            )}
            {method === "moonpay" && moonpayFee == null && shortfall > 0 && (
              <p className="text-sm text-[#8A8893]">MoonPay adds its card fee in the checkout. You’ll receive {money(shortfall)} USDC.</p>
            )}
            {method === "paj" && shortfall > 0 && (
              <p className="text-sm text-[#8A8893]">PAJ Cash adds its transfer fee in the Naira quote. You’ll receive {money(shortfall)} USDC.</p>
            )}
          </div>
          {shortfall <= 0 ? (
            <p className="mt-4 text-sm font-semibold text-[#5FD38E]">Your balance already covers the prize and the platform fee.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {METHODS.map((item) => {
                const on = method === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMethod(item.id)}
                    className="flex items-start gap-3 rounded-2xl border px-4 py-3 text-left"
                    style={{ background: on ? "rgba(255,90,26,0.1)" : "#1A1A20", borderColor: on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.07)" }}
                  >
                    <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full border-2" style={{ borderColor: on ? "#FF7A2A" : "#4A4A55" }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? "#FF7A2A" : "transparent" }} />
                    </span>
                    <span>
                      <span className="block text-[15px] font-bold">{item.title}</span>
                      <span className="block text-sm text-[#8A8893]">{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={shortfall <= 0 ? onClose : start}
            disabled={shortfall > 0 && (feePending || !solanaAddress)}
            className="mt-4 w-full rounded-[18px] bg-gradient-to-r from-[#FF2D0A] to-[#F5B70C] py-4 text-base font-semibold text-white disabled:opacity-45"
            style={{ fontFamily: "var(--font-home-sora), Sora, sans-serif" }}
          >
            {!solanaAddress ? "Preparing your wallet…" : shortfall <= 0 ? "Done" : "Continue to top up"}
          </button>
        </div>
      </div>
      <DepositSheet
        open={deposit != null}
        launch={deposit}
        onClose={() => setDeposit(null)}
        balanceUsd={balanceUsd.toFixed(2)}
        solanaAddress={solanaAddress}
        devnetMode={devnetMode}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[#B5B2BC]">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
