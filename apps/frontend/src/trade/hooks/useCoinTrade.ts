"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import { PUMP_UNSUPPORTED, buildPump, buildSwap, quotePump, quoteSwap, submitSwap, type SwapQuote } from "@/trade/lib/api";
import { USDC, WSOL, b64ToBytes, baseToHuman, bytesToB64, fmt } from "@/trade/lib/solana";
import { getSolUsd } from "@/trade/lib/holdings";
import { getConnection, getSolBalance, getTokenBalance, waitForConfirmation } from "@/trade/lib/balances";
import { fetchMemecoinDetail, type MemecoinDetail } from "@/trade/lib/memecoin";
import type { CoinRef } from "@/trade/lib/coin";
import { reportTrade } from "@/trade/lib/rewards";
import { useWallet } from "@/trade/hooks/useWallet";

export type Side = "buy" | "sell";

export const BUY_PRESETS = ["10", "25", "50", "100"];
export const SELL_PRESETS = [25, 50, 75, 100];
const SLIPPAGE_BPS = 300;
/** Kept back in the wallet when buying with SOL, so the account can still pay network fees. */
const SOL_RESERVE = 0.01;
/** Selling SOL itself leaves about this much behind for fees. */
const SOL_SELL_RESERVE = 0.002;

/**
 * Everything the trade box needs for one coin: balances, a quote that follows what was typed, and the swap itself.
 * Same routing and safety rules as the phone app: USDC first, SOL as the fallback, Pump's own program for coins still
 * on the curve, and the backend pays the network fee when it can.
 */
export function useCoinTrade(coin: CoinRef, startSide: Side = "buy") {
  const { address, wallet, userId, getAccessToken, signTransaction } = useWallet();
  const [side, setSideState] = useState<Side>(startSide);
  const [amount, setAmount] = useState("");
  const [solBal, setSolBal] = useState<number | null>(null);
  const [usdcBal, setUsdcBal] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [tokBal, setTokBal] = useState<number | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sig: string; out: string; side: Side } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemecoinDetail | null>(null);
  const [pumpOff, setPumpOff] = useState(false);
  const reqId = useRef(0);

  // A different coin starts clean.
  useEffect(() => {
    setAmount("");
    setQuote(null);
    setQuoteErr(null);
    setDone(null);
    setError(null);
    setPumpOff(false);
    setDetail(null);
  }, [coin.mint]);

  // Safety checks only exist for coins the terminal tracks. Anything else just skips this.
  useEffect(() => {
    let alive = true;
    fetchMemecoinDetail(coin.mint)
      .then((d) => alive && setDetail(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [coin.mint]);

  const loadBalances = useCallback(async () => {
    if (!address) return;
    try {
      const [s, t, u] = await Promise.all([getSolBalance(address), getTokenBalance(address, coin.mint), getTokenBalance(address, USDC)]);
      setSolBal(s);
      setUsdcBal(u);
      setTokBal(t);
    } catch {
      /* balances are a convenience, the swap itself still works */
    }
  }, [address, coin.mint]);
  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    let alive = true;
    getSolUsd()
      .then((v) => alive && setSolUsd(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const item = detail ?? coin.item ?? null;
  const typed = Number(amount);
  const usePump = coin.mint.endsWith("pump") && item?.stage.key !== "grad" && !pumpOff;
  const isSol = coin.mint === WSOL;
  const buyWithUsdc = !usePump && side === "buy" && (isSol || ((usdcBal ?? 0) >= typed && typed > 0));
  const inputMint = side === "buy" ? (buyWithUsdc ? USDC : WSOL) : coin.mint;
  const outputMint = side === "buy" ? coin.mint : USDC;
  const swapNum = side === "buy" ? (buyWithUsdc ? typed : solUsd ? typed / solUsd : 0) : typed;
  const swapAmount = side === "buy" ? (swapNum > 0 ? String(Number(swapNum.toFixed(9))) : "") : amount;
  const sellBal = isSol ? Math.max(0, (solBal ?? 0) - SOL_SELL_RESERVE) : tokBal;
  const balance = side === "buy" ? (isSol ? usdcBal : solBal) : sellBal;
  const maxSol = Math.max(0, (solBal ?? 0) - SOL_RESERVE);
  const maxSolUsd = maxSol * (solUsd ?? 0);
  const maxAmount = side === "buy" ? (isSol ? (usdcBal ?? 0) : usePump ? maxSolUsd : Math.max(usdcBal ?? 0, maxSolUsd)) : (sellBal ?? 0);
  const over = balance != null && (side === "buy" ? typed > maxAmount + 1e-9 : swapNum > (sellBal ?? 0) + 1e-12);
  const digits = Math.min(coin.decimals, 9);
  const showOut = (outAmount: string, outDecimals: number) => {
    const out = baseToHuman(outAmount, outDecimals);
    return side === "buy" ? `${fmt(out)} ${coin.symbol}` : `$${fmt(out, 2)}`;
  };

  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!(Number(swapAmount) > 0) || !userId) return;
    const id = ++reqId.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        const q = usePump
          ? await quotePump({ mint: coin.mint, side, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token)
          : await quoteSwap({ inputMint, outputMint, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token);
        if (reqId.current === id) setQuote(q);
      } catch (e) {
        const msg = e instanceof Error && e.message.startsWith(PUMP_UNSUPPORTED) ? e.message : humanError(e, "No route found");
        if (msg.startsWith(PUMP_UNSUPPORTED)) {
          if (reqId.current === id) setPumpOff(true);
          return;
        }
        if (reqId.current === id) setQuoteErr(msg);
      } finally {
        if (reqId.current === id) setQuoting(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [swapAmount, inputMint, outputMint, userId, getAccessToken, usePump, side, coin.mint]);

  const trade = async () => {
    if (!wallet || !quote || over || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const built = usePump
        ? await buildPump({ mint: coin.mint, side, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token)
        : await buildSwap({ inputMint, outputMint, amount: swapAmount, slippageBps: SLIPPAGE_BPS }, token);
      const { signedTransaction } = await signTransaction({
        transaction: b64ToBytes(built.swapTransaction),
        wallet,
        chain: "solana:mainnet",
        options: { uiOptions: { showWalletUIs: false } },
      });
      let sig: string;
      if (built.gasless && built.id) {
        ({ signature: sig } = await submitSwap({ id: built.id, signedTransaction: bytesToB64(signedTransaction) }, token));
      } else {
        sig = await getConnection().sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
        await waitForConfirmation(sig);
        void reportTrade(built.tradeId, sig, token);
      }
      setDone({ sig, side, out: showOut(built.outAmount, built.outDecimals) });
      void loadBalances();
    } catch (e) {
      const msg = e instanceof Error && e.message.startsWith(PUMP_UNSUPPORTED) ? e.message : humanError(e, "Trade failed");
      if (msg.startsWith(PUMP_UNSUPPORTED)) {
        setPumpOff(true);
        setError("Switched to another route. Try again.");
      } else if (!/reject|cancel|denied/i.test(msg)) {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onLaunchpad = item?.status === "launchpad";
  const tooLittleSol = side === "sell" && isSol && solBal != null && (sellBal ?? 0) < 0.0005;
  const problem = tooLittleSol ? "Too little SOL to sell. About 0.002 SOL stays for the network fee." : over ? "Not enough balance" : error || (quoteErr ? (onLaunchpad && pumpOff ? "This coin cannot be traded right now." : quoteErr) : null);
  const impact = quote ? Math.abs(quote.priceImpactPct) * 100 : null;

  const setSide = (s: Side) => {
    setSideState(s);
    setAmount("");
    setError(null);
    setDone(null);
  };
  const setPreset = (p: string | number) => {
    if (side === "buy") setAmount(String(p));
    else {
      const v = ((sellBal ?? 0) * Number(p)) / 100;
      setAmount(v > 0 ? String(Number(v.toFixed(digits))) : "");
    }
  };
  const setMax = () => setAmount(maxAmount > 0 ? String(side === "buy" ? Math.floor(maxAmount * 100) / 100 : Number(maxAmount.toFixed(digits))) : "");

  return {
    side, setSide, amount, setAmount, setPreset, setMax, typed,
    quote, quoting, problem, impact, over, busy, done, setDone,
    trade, balance, usdcBal, solBal, tokBal, address, wallet, userId, item,
    outText: quote ? showOut(quote.outAmount, quote.outDecimals) : null,
    ready: !!quote && !over && !busy && !!wallet,
  };
}
