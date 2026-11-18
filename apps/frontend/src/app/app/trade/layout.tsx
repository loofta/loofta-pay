import type { ReactNode } from "react";
import "@/trade/trade.css";

export const metadata = { title: "Trade | Loofta", description: "Trade coins, stocks and predictions on Loofta." };

export default function TradeLayout({ children }: { children: ReactNode }) {
  return <div className="trade-root">{children}</div>;
}
