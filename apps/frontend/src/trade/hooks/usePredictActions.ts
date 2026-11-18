"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/trade/hooks/useWallet";
import { getConnection, waitForConfirmation } from "@/trade/lib/balances";
import { FEE_WALLET, predictFeeUsd } from "@/trade/lib/fees";
import { buildTransfer } from "@/trade/lib/transfer";
import { USDC, b64ToBytes, bytesToB64 } from "@/trade/lib/solana";
import { reportPrediction } from "@/trade/lib/rewards";
import { POSITIONS_PAGE, claimPosition, closePosition, createBuyOrder, getPositionsPage, orderStatus, type OrderTx, type PredictMarket, type PredictPosition } from "@/trade/lib/predict";

export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  return /reject|cancel|denied/i.test(m) ? "Cancelled." : m || "Something went wrong. Try again.";
};

/** Signs a transaction from Jupiter with the user's own wallet and sends it. */
export function useSender() {
  const { wallet, signTransaction } = useWallet();
  return useCallback(
    async (tx: OrderTx | { transaction: string }) => {
      if (!wallet) throw new Error("Your wallet is still loading.");
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(tx.transaction), wallet, chain: "solana:mainnet", options: { uiOptions: { showWalletUIs: false } } });
      const sig = await getConnection().sendRawTransaction(signedTransaction, { skipPreflight: true, maxRetries: 3 });
      await waitForConfirmation(sig);
      return sig;
    },
    [wallet, signTransaction],
  );
}

/** Buy Yes or No, then take the Loofta fee once the bet is in. Same steps as the phone app. */
export function usePlaceBet() {
  const { address, getAccessToken } = useWallet();
  const send = useSender();
  return useCallback(
    async (market: PredictMarket, isYes: boolean, amt: number): Promise<{ filled: boolean }> => {
      if (!address) throw new Error("Your wallet is still loading.");
      const order = await createBuyOrder({ owner: address, marketId: market.marketId, isYes, usd: amt, mint: USDC });
      const orderSig = await send(order);
      const key = order.order?.orderPubkey;
      let state = "";
      for (let i = 0; key && i < 15 && state !== "filled" && state !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await orderStatus(key).catch(() => null);
        state = String(s?.status ?? s?.data?.status ?? "").toLowerCase();
      }
      if (state === "failed") throw new Error("The order did not fill and nothing was taken. Try again.");
      const fee = predictFeeUsd(amt);
      if (fee > 0) {
        try {
          const raw = await buildTransfer({ from: address, to: FEE_WALLET, token: "USDC", amount: fee });
          await send({ transaction: bytesToB64(raw) });
        } catch {
          /* the bet is placed, the fee is not worth failing it over */
        }
      }
      void getAccessToken().then((t) => reportPrediction(orderSig, [{ marketId: market.marketId, side: isYes ? "yes" : "no" }], t)).catch(() => undefined);
      return { filled: state === "filled" || !key };
    },
    [address, send, getAccessToken],
  );
}

/** Cash out an open bet, or claim a win. */
export function useBetAction() {
  const { address } = useWallet();
  const send = useSender();
  return useCallback(
    async (p: PredictPosition, kind: "sell" | "claim") => {
      if (!address) throw new Error("Your wallet is still loading.");
      const tx = kind === "claim" ? await claimPosition(p.pubkey, address) : await closePosition(p.pubkey, address);
      await send(tx);
    },
    [address, send],
  );
}

/** Every bet this wallet has, newest page first, up to five pages. */
export function useMyBets(address: string | null) {
  const [items, setItems] = useState<PredictPosition[] | null>(null);
  const load = useCallback(async () => {
    if (!address) return;
    try {
      const all: PredictPosition[] = [];
      for (let page = 0; page < 5; page++) {
        const r = await getPositionsPage(address, page * POSITIONS_PAGE);
        all.push(...r.items);
        if (!r.hasNext) break;
      }
      setItems(all);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, [address]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  return { items, reload: load };
}
