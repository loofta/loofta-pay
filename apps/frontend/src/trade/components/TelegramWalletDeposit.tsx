"use client";

import { useEffect, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import { Address, beginCell } from "@ton/core";
import { useTonWallet } from "@/trade/lib/ton";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { findUsdcOnSolana, getNearQuote, getNearStatus, type NearToken, type NearQuote } from "@/trade/lib/near";
import { fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";

/** The NEAR Intents asset for native Toncoin (the token list names it GRAM). The USDT jetton shares the prefix but has a contract suffix. */
const isNativeTon = (t: NearToken) => t.chain === "ton" && t.assetId.endsWith("_") && t.assetId.includes("1117");

/**
 * Pay from Telegram Wallet. TON Connect asks the wallet to send Toncoin to a one-time deposit
 * address, and NEAR Intents delivers it as USDC to the user's Solana wallet.
 */
export function TelegramWalletDeposit({ address, tokens }: { address: string; tokens: NearToken[] }) {
  const { ui, rawAddress } = useTonWallet();
  const wallet = rawAddress;
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<NearQuote | null>(null);
  const [status, setStatus] = useState("PENDING_DEPOSIT");

  const ton = tokens.find(isNativeTon) ?? null;
  const usdc = findUsdcOnSolana(tokens);
  const usd = Number(amount);
  const tonAmount = ton?.price && usd > 0 ? usd / ton.price : 0;
  const from = wallet ? Address.parseRaw(wallet).toString({ bounceable: false }) : "";

  useEffect(() => {
    if (!quote) return;
    let alive = true;
    const t = setInterval(() => getNearStatus(quote.depositAddress).then((s) => alive && setStatus(s)).catch(() => {}), 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [quote]);

  const pay = async () => {
    if (!ton || !usdc || !wallet || !ui || !(tonAmount > 0)) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      const nano = BigInt(Math.round(tonAmount * 1e9));
      const q = await getNearQuote({ originAsset: ton.assetId, destinationAsset: usdc.assetId, amountAtomic: nano.toString(), recipient: address, refundTo: from });
      // A memo, if the service wants one, travels as a plain text comment on the transfer.
      const payload = q.memo ? beginCell().storeUint(0, 32).storeStringTail(q.memo).endCell().toBoc().toString("base64") : undefined;
      await ui.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 300, messages: [{ address: q.depositAddress, amount: nano.toString(), payload }] });
      haptic("success");
      setQuote(q);
    } catch (e) {
      const msg = humanError(e, "Payment failed");
      if (!/reject|cancel|declin|user/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (quote) {
    const done = status === "SUCCESS";
    const failed = status === "FAILED" || status === "REFUNDED";
    return (
      <div className={clsx("mt-4 rounded-2xl px-4 py-3 text-base font-semibold", done ? "bg-up/15 text-up" : failed ? "bg-down/15 text-down" : "bg-raised")}>
        {done ? "Done. Your money is in." : failed ? "This deposit did not complete and is being refunded." : `Sent. Arriving in about a minute${quote.amountOutFormatted ? ` as $${fmt(Number(quote.amountOutFormatted), 2)} USDC` : ""}.`}
      </div>
    );
  }

  if (!wallet) {
    return (
      <div>
        <p className="mt-4 text-base leading-snug text-mute">Pay with Toncoin from your Telegram Wallet. It arrives here as USDC.</p>
        <button type="button" disabled={!ui} onClick={() => ui?.openModal()} className="btn3d mt-4 h-16 w-full text-lg">
          Connect Telegram Wallet
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
        <span className="text-base text-mute">Connected {from.slice(0, 5)}...{from.slice(-4)}</span>
        <button type="button" onClick={() => ui?.disconnect()} className="text-base font-semibold">Disconnect</button>
      </div>
      <div className="mt-3 flex h-14 items-center rounded-2xl bg-surface px-4">
        <span className="pr-1 font-display text-xl font-bold text-mute">$</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
      </div>
      {tonAmount > 0 && <div className="mt-1 text-base text-mute">You send about {tonAmount.toFixed(2)} TON</div>}
      {error && <div className="mt-2 text-base text-down">{error}</div>}
      <button type="button" disabled={!(tonAmount > 0) || busy || !ton || !usdc} onClick={pay} className="btn3d mt-4 flex h-16 w-full items-center justify-center gap-2 text-lg">
        {busy && <Loader2 size={20} className="animate-spin" />}
        {busy ? "Confirm in Telegram Wallet" : "Pay from Telegram Wallet"}
      </button>
      <p className="mt-2 text-base text-mute">If it cannot complete, it is refunded to this wallet.</p>
    </div>
  );
}
