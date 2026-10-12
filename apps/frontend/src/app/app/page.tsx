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
      const method = methodRaw === "peer" || methodRaw === "paj" || methodRaw === "crypto" ? methodRaw : undefined;
      window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: balance, method } }));
    }
  }, [router, searchParams]);

  return <AppHome />;
}
