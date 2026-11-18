"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownToLine, ArrowUpFromLine, AtSign, Check, Copy, ExternalLink, Loader2, LogOut, Sparkles } from "lucide-react";
import { useWallet } from "@/trade/hooks/useWallet";
import { getConnection, waitForConfirmation } from "@/trade/lib/balances";
import { buildCleanup, closable, getTokenAccounts, RENT_PER_ACCOUNT_SOL, type TokenAcct } from "@/trade/lib/cleanup";
import { DUST_USD, usePortfolio } from "@/trade/lib/portfolio";
import { USDC, WSOL, fmt } from "@/trade/lib/solana";
import { haptic, openExternal } from "@/trade/lib/telegram";
import type { CoinRef } from "@/trade/lib/coin";
import { CoinRow } from "@/trade/components/CoinRow";
import { DepositSheet } from "@/trade/components/DepositSheet";
import { ActivitySheet } from "@/trade/components/ActivitySheet";
import { WithdrawSheet, type SendAsset } from "@/trade/components/WithdrawSheet";
import { Skeleton, Tile } from "@/trade/components/ui";

/** Portfolio: total balance, cash, open positions, clean-up of empty accounts, and the deposit and withdraw sheets. */
export function WalletTab({ onOpen, sendSignal = 0 }: { onOpen: (c: CoinRef, side?: "buy" | "sell") => void; sendSignal?: number }) {
  const { address, wallet, signTransaction } = useWallet();
  const { logout, user } = usePrivy();
  const { pf, total, reload } = usePortfolio(address);
  const [sheet, setSheet] = useState<"deposit" | "withdraw" | "activity" | null>(null);
  const [copied, setCopied] = useState(false);
  const [junk, setJunk] = useState<TokenAcct[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);

  // Empty accounts and dust: each one holds about 0.002 SOL of rent that comes back when it is closed.
  const findJunk = useCallback(() => {
    if (!address || !pf) return;
    getTokenAccounts(address)
      .then((a) => setJunk(closable(a, new Map(Object.entries(pf.prices ?? {})), DUST_USD)))
      .catch(() => {});
  }, [address, pf]);
  useEffect(findJunk, [findJunk]);

  const clean = async () => {
    if (!address || !wallet || junk.length === 0) return;
    setCleaning(true);
    setCleanMsg(null);
    try {
      const txs = await buildCleanup(address, junk);
      for (const tx of txs) {
        const { signedTransaction } = await signTransaction({ transaction: tx, wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
        const sig = await getConnection().sendRawTransaction(signedTransaction, { maxRetries: 3 });
        await waitForConfirmation(sig);
      }
      haptic("success");
      setCleanMsg(`Closed ${junk.length} account${junk.length === 1 ? "" : "s"}. About ${fmt(junk.length * RENT_PER_ACCOUNT_SOL, 4)} SOL came back.`);
      setJunk([]);
      reload();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setCleanMsg(/reject|cancel|denied/i.test(m) ? "Cancelled." : m || "Could not close the accounts. Try again.");
      haptic("error");
    } finally {
      setCleaning(false);
    }
  };

  const holdings = pf ? pf.holdings : null;
  // Everything that can be sent: USDC and SOL first, then every other coin with a price.
  const sendAssets: SendAsset[] = pf
    ? [
        { mint: USDC, symbol: "USDC", decimals: 6, amount: pf.usdc, price: 1, icon: null },
        { mint: WSOL, symbol: "SOL", decimals: 9, amount: pf.sol, price: pf.solUsd ?? 0, icon: null },
        ...pf.holdings.filter((h) => h.coin.mint !== WSOL && h.coin.mint !== USDC && h.amount > 0 && h.usd != null).map((h) => ({ mint: h.coin.mint, symbol: h.coin.symbol, decimals: h.coin.decimals, amount: h.amount, price: (h.usd ?? 0) / h.amount, icon: h.coin.icon })),
      ]
    : [];
  // Home's Send action lands here and opens the same sheet.
  useEffect(() => {
    if (sendSignal > 0) setSheet("withdraw");
  }, [sendSignal]);
  const name = user?.telegram?.username ? `@${user.telegram.username}` : address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "Your wallet";

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      haptic("success");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can be blocked in some webviews */
    }
  };

  return (
    <div className="px-4 pt-2">
      {/* profile */}
      <div className="flex items-center gap-3">
        <Tile tone="brand" size={52}>
          <img src="/icons/loofta-icon-white.svg" alt="" className="h-7 w-7" />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl font-extrabold">{name}</div>
          <button type="button" onClick={copy} className="flex items-center gap-1.5 text-base text-mute">
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Creating wallet..."}
            {copied ? <Check size={16} className="text-up" /> : <Copy size={16} />}
          </button>
        </div>
        <button type="button" onClick={() => logout()} aria-label="Log out" className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-mute active:scale-95">
          <LogOut size={20} />
        </button>
      </div>

      {/* balance + deposit */}
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <div className="text-base text-mute">Portfolio</div>
          <div className="font-display text-5xl font-extrabold tracking-tight">{total == null ? "$-" : `$${fmt(total, 2)}`}</div>
        </div>
        <button type="button" disabled={!address} onClick={() => setSheet("deposit")} className="btn3d h-14 shrink-0 px-6 text-lg">
          Deposit
        </button>
      </div>

      {/* cash: USDC only. SOL is listed below with the other coins. */}
      <div className="card mt-6 flex items-center gap-3 p-4">
        <Tile tone="green" size={52}>
          <span className="font-display text-2xl font-extrabold text-white">$</span>
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="text-base text-mute">Cash (USDC)</div>
          <div className="font-display text-2xl font-extrabold">{pf == null ? "$-" : `$${fmt(pf.usdc, 2)}`}</div>
        </div>
        <button type="button" onClick={() => setSheet("deposit")} aria-label="Deposit" className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl">
          <ArrowDownToLine size={20} />
        </button>
        <button type="button" onClick={() => setSheet("withdraw")} aria-label="Withdraw" className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl">
          <ArrowUpFromLine size={20} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => { haptic("tap"); setSheet("withdraw"); }} className="btn3d h-14 text-base">Send</button>
        <button type="button" onClick={() => { haptic("tap"); setSheet("activity"); }} className="btn3d dark h-14 text-base">Activity</button>
      </div>

      {/* To a username, Telegram, X, email, Revolut, Venmo and the like: the Loofta web app handles claim links and cash-outs. */}
      <button type="button" onClick={() => { haptic("tap"); openExternal("https://pay.loofta.xyz/send"); }} className="card mt-3 flex w-full items-center gap-3 p-4 text-left active:scale-[0.99]">
        <Tile tone="brand" size={48}>
          <AtSign size={22} className="text-white" />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold">Send to a handle</div>
          <div className="text-base text-mute">Telegram, X, email, Revolut, Venmo and more. They get a link to claim it.</div>
        </div>
        <ExternalLink size={18} className="shrink-0 text-mute" />
      </button>
      {pf && <div className="mt-2 px-2 text-base text-mute">{fmt(pf.sol, 4)} SOL covers network fees. Buying with cash never needs it.</div>}

      {/* clean up */}
      {(junk.length > 0 || cleanMsg) && (
        <div className="card mt-6 p-4">
          <div className="flex items-center gap-3">
            <Tile tone="brand" size={44}>
              <Sparkles size={20} className="text-white" />
            </Tile>
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg font-bold">Clean up</div>
              <div className="text-base text-mute">{cleanMsg ?? `${junk.length} empty or worthless coin account${junk.length === 1 ? "" : "s"}. Closing them gives back about ${fmt(junk.length * RENT_PER_ACCOUNT_SOL, 4)} SOL.`}</div>
            </div>
          </div>
          {junk.length > 0 && (
            <button type="button" onClick={clean} disabled={cleaning || !wallet} className="btn3d mt-3 flex h-14 w-full items-center justify-center gap-2 text-base">
              {cleaning && <Loader2 size={18} className="animate-spin" />}
              {cleaning ? "Closing" : "Close accounts"}
            </button>
          )}
        </div>
      )}

      {/* positions */}
      <h2 className="mb-3 mt-8 font-display text-lg font-bold">Coins{holdings ? ` (${holdings.length})` : ""}</h2>
      <div className="space-y-3">
        {holdings === null && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        {holdings?.length === 0 && <div className="card px-4 py-8 text-center text-base text-mute">No coins yet. Pick one in Trade.</div>}
        {holdings?.map((h) => (
          <CoinRow
            key={h.coin.mint}
            coin={h.coin}
            onOpen={(c) => onOpen(c, "sell")}
            right={
              <div className="text-right">
                <div className="font-display text-base font-bold">{h.usd != null ? `$${fmt(h.usd, 2)}` : "-"}</div>
                <div className="text-base text-mute">{fmt(h.amount)}</div>
              </div>
            }
          />
        ))}
      </div>


      {sheet === "deposit" && address && <DepositSheet address={address} onClose={() => setSheet(null)} />}
      {sheet === "withdraw" && <WithdrawSheet assets={sendAssets} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet === "activity" && <ActivitySheet onClose={() => setSheet(null)} />}
    </div>
  );
}
