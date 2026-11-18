"use client";

import { FeedList } from "@/trade/components/FeedList";
import type { CoinRef } from "@/trade/lib/coin";

/** Everything Loofta people are doing: bets, buys and what holders say about their coins. */
export function FeedTab({ onOpen, onOpenPrediction }: { onOpen: (c: CoinRef) => void; onOpenPrediction: (eventId: string) => void }) {
  return (
    <div className="px-4 pt-2">
      <h1 className="font-display text-3xl font-extrabold">Feed</h1>
      <FeedList onOpen={onOpen} onOpenPrediction={onOpenPrediction} />
    </div>
  );
}
