"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHome } from "@/components/app-home/AppHome";

export default function AppHomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const create = searchParams.get("create");
    if (tab === "send" || tab === "receive" || create === "1") {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === "receive") next.set("tab", "receive");
      router.replace(`/app/send${next.toString() ? `?${next}` : ""}`);
      return;
    }
    const balance = searchParams.get("balance");
    if (balance === "topup" || balance === "withdraw" || balance === "history") {
      const methodRaw = searchParams.get("method");
      const method = methodRaw === "peer" || methodRaw === "paj" || methodRaw === "crypto" || methodRaw === "cash" ? methodRaw : undefined;
      // The partner withdraw page can pass a P2P platform, handle and amount so the cash-out opens filled in.
      const platformId = searchParams.get("platform");
      const to = searchParams.get("to");
      const amountUsd = Number(searchParams.get("amount"));
      const symbol = searchParams.get("symbol");
      const chain = searchParams.get("chain");
      const cryptoPrefill = method === "crypto" && symbol && chain && to && Number.isFinite(amountUsd) && amountUsd > 0 ? { symbol, chain, address: to, amountUsd } : undefined;
      const peerPay = method === "peer" && platformId && to && Number.isFinite(amountUsd) && amountUsd > 0 ? { platformId, identifier: to, amountUsd, ...(searchParams.get("intent") === "receive" ? { intent: "receive" as const } : {}), ...(searchParams.get("fast") === "1" ? { fast: true } : {}) } : undefined;
      window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: balance, method, peerPay, cryptoPrefill } }));
    }
  }, [router, searchParams]);

  return <AppHome />;
}
