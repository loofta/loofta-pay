"use client";

import { useEffect, useState } from "react";
import { humanError } from "@/trade/lib/errors";
import { PublicKey } from "@solana/web3.js";
import { Check, ChevronDown, Loader2, Lock } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { TokenPicker } from "@/trade/components/TokenPicker";
import { Avatar, Segmented } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import { getConnection, waitForConfirmation } from "@/trade/lib/balances";
import { addressLooksValid, chainName, fetchNearTokens, findUsdcOnSolana, getNearQuote, toAtomic, type NearToken } from "@/trade/lib/near";
import { buildPrivateTokenSend, buildPrivateUsdcSend, recordPrivateSendSignature, type PrivateSendBuild } from "@/trade/lib/pay";
import { USDC, WSOL, b64ToBytes, fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";
import { buildTokenTransfer, buildTransfer } from "@/trade/lib/transfer";
import { FEE_WALLET, WITHDRAW_FEE_BPS, withdrawFeeUsd } from "@/trade/lib/fees";

type Mode = "solana" | "other";

/** One thing the user can send: USDC, SOL or any coin they hold. `price` is dollars per coin. */
export type SendAsset = { mint: string; symbol: string; decimals: number; amount: number; price: number; icon?: string | null };

/** Left in the wallet for the network fee, and for the receiver's token account when sending USDC. */
const SOL_KEEP = 0.01;
/** A private SOL send also needs room for MagicBlock's own charge and a wrapped-SOL account. */
const SOL_KEEP_PRIVATE = 0.015;

/** A plain decimal string for the backend, rounded down so it never asks for more than the wallet holds. */
function decimalString(units: number, decimals: number): string {
  const d = Math.min(decimals, 12);
  const s = (Math.floor(units * 10 ** d) / 10 ** d).toFixed(d);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

/** Send money out: to any Solana address (any coin, publicly or privately), or to another chain through NEAR Intents. The user's wallet pays the network fee. */
export function WithdrawSheet({ assets, onClose, onDone }: { assets: SendAsset[]; onClose: () => void; onDone: () => void }) {
  const { address, wallet, signTransaction, getAccessToken } = useWallet();
  const [mode, setMode] = useState<Mode>("solana");
  const [mint, setMint] = useState(USDC);
  const [pickingAsset, setPickingAsset] = useState(false);
  const [priv, setPriv] = useState(false);
  const [tokens, setTokens] = useState<NearToken[]>([]);
  const [dest, setDest] = useState<NearToken | null>(null);
  const [picking, setPicking] = useState(false);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ usd: number; private: boolean } | null>(null);
  const [review, setReview] = useState<{ build: PrivateSendBuild; units: number } | null>(null);

  useEffect(() => {
    fetchNearTokens().then(setTokens).catch(() => {});
  }, []);

  const usdcAsset = assets.find((a) => a.mint === USDC);
  const asset = mode === "other" ? usdcAsset : assets.find((a) => a.mint === mint) ?? usdcAsset;
  const isSol = asset?.mint === WSOL;
  const isUsdc = asset?.mint === USDC;
  const price = asset?.price ?? 0;
  const keep = isSol ? (priv && mode === "solana" ? SOL_KEEP_PRIVATE : SOL_KEEP) : 0;
  const maxUnits = Math.max(0, (asset?.amount ?? 0) - keep);
  const maxUsd = maxUnits * price;

  const nearUsdc = findUsdcOnSolana(tokens);
  const typed = Number(amount);
  const unitsWanted = price > 0 ? typed / price : 0;
  // Typing the full balance sends exactly all of it, so no dust is left behind.
  const units = typed >= maxUsd - 0.005 && maxUsd > 0 ? maxUnits : unitsWanted;
  const over = units > maxUnits + 1e-12;
  const isPriv = priv && mode === "solana";
  const destOk = mode === "solana" ? (() => { try { return !!to.trim() && PublicKey.isOnCurve(new PublicKey(to.trim()).toBytes()); } catch { return false; } })() : !!dest && addressLooksValid(dest.chain, to);
  // Public sends of USDC or SOL carry the Loofta fee, taken out of the amount typed. Private sends include their own fee. Other coins and bridges carry none of ours.
  const feeUsd = mode === "solana" && !isPriv && (isUsdc || isSol) ? withdrawFeeUsd(typed) : 0;
  const receiveUsd = Math.max(0, typed - feeUsd);
  const tooSmallPrivate = isPriv && typed < 1;
  const ready = typed > 0 && !over && destOk && !tooSmallPrivate && (mode === "solana" ? !!asset : !!dest && !!nearUsdc) && !!wallet && !!address;

  const signAndSend = async (txBytes: Uint8Array) => {
    if (!wallet) throw new Error("Your wallet is still loading.");
    const { signedTransaction } = await signTransaction({ transaction: txBytes, wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
    const signature = await getConnection().sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    await waitForConfirmation(signature);
    return signature;
  };
  const fail = (e: unknown) => {
    const msg = humanError(e, "Could not send");
    if (!/reject|cancel|denied/i.test(msg)) {
      haptic("error");
      setError(msg);
    }
  };

  // Private send, step 1: the server builds the transfer so the real fee is known before anything is signed.
  const reviewPrivate = async () => {
    if (!asset || !address) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      const token = await getAccessToken();
      const build = isUsdc ? await buildPrivateUsdcSend(typed, to.trim(), token) : await buildPrivateTokenSend(asset.mint, decimalString(units, asset.decimals), to.trim(), token);
      setReview({ build, units });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Private send, step 2: sign and send. For USDC the server finishes delivery once the first leg lands.
  const confirmPrivate = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const sig = await signAndSend(b64ToBytes(review.build.transactionBase64));
      if (isUsdc && review.build.id) void recordPrivateSendSignature(review.build.id, sig, token).catch(() => {});
      haptic("success");
      setDone({ usd: typed, private: true });
      setReview(null);
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!wallet || !address || !asset) return;
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      let target = to.trim();
      let tx: Uint8Array;
      if (mode === "other") {
        if (!dest || !nearUsdc) throw new Error("Pick where the money goes");
        const q = await getNearQuote({ originAsset: nearUsdc.assetId, destinationAsset: dest.assetId, amountAtomic: toAtomic(amount, 6), recipient: to.trim(), refundTo: address });
        target = q.depositAddress;
        tx = await buildTransfer({ from: address, to: target, token: "USDC", amount: units });
      } else if (isUsdc || isSol) {
        // The fee is a share of the amount, so both scale together.
        const feeUnits = typed > 0 && feeUsd > 0 ? (units * feeUsd) / typed : 0;
        tx = await buildTransfer({ from: address, to: target, token: isSol ? "SOL" : "USDC", amount: units - feeUnits, fee: feeUnits > 0 ? { to: FEE_WALLET, amount: feeUnits } : undefined });
      } else {
        tx = await buildTokenTransfer({ from: address, to: target, mint: asset.mint, rawAmount: BigInt(Math.floor(units * 10 ** asset.decimals)), decimals: asset.decimals });
      }
      await signAndSend(tx);
      haptic("success");
      setDone({ usd: typed, private: false });
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet title="Sent" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="anim-pop tile3d green grid h-20 w-20 place-items-center rounded-[28px] text-white">
            <Check size={42} strokeWidth={3} />
          </div>
          <div className="font-display text-2xl font-extrabold">${fmt(done.usd, 2)} on its way</div>
          <p className="text-base text-mute">{done.private ? "Sent privately. It lands after a short, random delay and nothing links it to you." : mode === "other" ? "Other chains take a few minutes to arrive." : "It should land in seconds."}</p>
          <button type="button" onClick={onClose} className="btn3d mt-2 h-14 w-full text-lg">Done</button>
        </div>
      </Sheet>
    );
  }

  if (review && asset) {
    const feeLabel = isUsdc ? review.build.feeAmountUsdc ?? 0 : review.build.feeAmountUsd ?? 0;
    return (
      <Sheet title="Confirm private send" onClose={() => !busy && setReview(null)}>
        <div className="mt-4 space-y-3 text-base">
          <div className="flex justify-between"><span className="text-mute">To</span><span className="font-display font-bold">{to.trim().slice(0, 6)}...{to.trim().slice(-4)}</span></div>
          <div className="flex justify-between"><span className="text-mute">You send</span><span className="font-display font-bold">{isUsdc ? `$${fmt(typed, 2)}` : `${fmt(review.units)} ${asset.symbol} (about $${fmt(typed, 2)})`}</span></div>
          <div className="flex justify-between"><span className="text-mute">Privacy fee</span><span className="font-display font-bold">${fmt(feeLabel, 2)}</span></div>
          {isUsdc && <div className="flex justify-between border-t border-white/10 pt-3"><span className="text-mute">They receive</span><span className="font-display font-bold">${fmt(Math.max(0, typed - feeLabel), 2)}</span></div>}
          <p className="text-mute">Delivery is split and delayed by a few minutes so it cannot be matched to you. You sign once. Check the address, sends cannot be undone.</p>
          {error && <div className="text-down">{error}</div>}
          <button type="button" onClick={confirmPrivate} disabled={busy} className="btn3d flex h-16 w-full items-center justify-center gap-2 text-lg">
            {busy && <Loader2 size={20} className="animate-spin" />}
            {busy ? "Sending" : "Confirm and sign"}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Send" onClose={onClose}>
      <div className="mt-4">
        <Segmented<Mode> value={mode} onChange={(m) => { setMode(m); setAmount(""); setError(null); haptic("tap"); }} options={[{ id: "solana", label: "Solana" }, { id: "other", label: "Other chains" }]} />
      </div>

      {pickingAsset ? (
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {assets.map((a) => (
            <button key={a.mint} type="button" onClick={() => { setMint(a.mint); setAmount(""); setPickingAsset(false); }} className="flex h-16 w-full items-center gap-3 rounded-2xl bg-surface px-3 text-left">
              <Avatar mint={a.mint} symbol={a.symbol} src={a.icon ?? null} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-base font-bold">{a.symbol}</div>
                <div className="text-base text-mute">{fmt(a.amount)}</div>
              </div>
              <div className="font-display text-base font-bold">${fmt(a.amount * a.price, 2)}</div>
            </button>
          ))}
        </div>
      ) : picking ? (
        <TokenPicker tokens={tokens} hide={(t) => t.chain === "sol"} onPick={(t) => { setDest(t); setPicking(false); setTo(""); }} />
      ) : (
        <>
          {mode === "solana" && asset && (
            <button type="button" onClick={() => setPickingAsset(true)} className="mt-3 flex h-14 w-full items-center gap-3 rounded-2xl bg-surface px-4 text-left">
              <Avatar mint={asset.mint} symbol={asset.symbol} src={asset.icon ?? null} size={32} />
              <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{asset.symbol}</span>
              <span className="text-base text-mute">{fmt(asset.amount)}</span>
              <ChevronDown size={18} className="text-mute" />
            </button>
          )}
          {mode === "other" && (
            <button type="button" onClick={() => setPicking(true)} className="mt-3 flex h-14 w-full items-center justify-between rounded-2xl bg-surface px-4 text-left">
              <span className="text-base text-mute">You receive</span>
              <span className="font-display text-base font-bold">{dest ? `${dest.symbol} on ${chainName(dest.chain)}` : "Choose"}</span>
            </button>
          )}
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={mode === "solana" ? "Solana address" : dest ? `Your ${chainName(dest.chain)} address` : "Destination address"} className="mt-3 h-14 w-full rounded-2xl bg-surface px-4 text-base outline-none placeholder:text-mute" />
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-14 min-w-0 flex-1 items-center rounded-2xl bg-surface px-4">
              <span className="pr-1 font-display text-xl font-bold text-mute">$</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
            </div>
            <button type="button" onClick={() => setAmount(maxUsd > 0 ? String(Math.floor(maxUsd * 100) / 100) : "")} className="btn3d dark h-14 shrink-0 px-5 !rounded-2xl text-base">Max</button>
          </div>
          <div className="mt-1 text-base text-mute">Available ${fmt(maxUsd, 2)}</div>

          {/* Private: any coin, delivered after a short random delay so it cannot be linked to you. Not for other chains. */}
          {mode === "solana" && (
            <button type="button" role="switch" aria-checked={priv} onClick={() => { haptic("tap"); setPriv((v) => !v); setError(null); }} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#FF7A2A]/20 text-[#FF7A2A]"><Lock size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold">Send privately</span>
                <span className="block text-base text-mute">Hides who sent it. Lands after a short, random delay.</span>
              </span>
              <span className={priv ? "flex h-8 w-14 shrink-0 items-center justify-end rounded-full bg-[#FF7A2A] p-1" : "flex h-8 w-14 shrink-0 items-center justify-start rounded-full bg-[#3A3A42] p-1"}><span className="h-6 w-6 rounded-full bg-white" /></span>
            </button>
          )}

          {over && <div className="mt-2 text-base text-down">Not enough balance</div>}
          {tooSmallPrivate && typed > 0 && <div className="mt-2 text-base text-down">Private sends start at $1.</div>}
          {error && <div className="mt-2 text-base text-down">{error}</div>}
          {typed > 0 && (
            <div className="mt-3 space-y-1 rounded-2xl bg-surface px-4 py-3 text-base">
              <div className="flex justify-between"><span className="text-mute">You send</span><span className="font-semibold">${fmt(typed, 2)}</span></div>
              {mode === "other" ? (
                <div className="flex justify-between"><span className="text-mute">Bridge fee</span><span className="font-semibold">included in the quote</span></div>
              ) : isPriv ? (
                <div className="flex justify-between"><span className="text-mute">Privacy fee</span><span className="font-semibold">shown before you sign</span></div>
              ) : feeUsd > 0 ? (
                <>
                  <div className="flex justify-between"><span className="text-mute">Loofta fee ({(WITHDRAW_FEE_BPS / 100).toFixed(2)}%)</span><span className="font-semibold">${fmt(feeUsd, 2)}</span></div>
                  <div className="flex justify-between"><span className="text-mute">They receive</span><span className="font-semibold">${fmt(receiveUsd, 2)}</span></div>
                </>
              ) : null}
            </div>
          )}
          <p className="mt-2 text-base text-mute">The network fee, a fraction of a cent, is paid from your SOL. Check the address, sends cannot be undone.</p>
          <button type="button" disabled={!ready || busy} onClick={isPriv ? reviewPrivate : send} className="btn3d mt-3 flex h-16 w-full items-center justify-center gap-2 text-lg">
            {busy && <Loader2 size={20} className="animate-spin" />}
            {busy ? (isPriv ? "Preparing" : "Sending") : isPriv ? "Review private send" : "Send"}
          </button>
        </>
      )}
    </Sheet>
  );
}
