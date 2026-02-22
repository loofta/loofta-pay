'use client'

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * /link/[@username] redirects to the app Send tab with ?to=username
 * so the pay-to-user form shows under Send with the same layout and dark card.
 */
export default function LinkPayPage({ params }: { params: Promise<{ username: string[] }> }) {
  const { username: usernameArray } = React.use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const username = decodeURIComponent(usernameArray.join("/"));
  const cleanUsername = username.replace(/^@/, "").toLowerCase();
  const amountFromQuery = searchParams.get("amount");

  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("tab", "send");
    qs.set("to", cleanUsername);
    if (amountFromQuery != null && amountFromQuery !== "" && !isNaN(Number(amountFromQuery)) && Number(amountFromQuery) >= 0) {
      qs.set("amount", amountFromQuery);
    }
    router.replace(`/?${qs.toString()}`);
  }, [cleanUsername, amountFromQuery, router]);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] flex items-center justify-center">
      <p className="text-slate-400 text-sm">Taking you to Send…</p>
    </div>
  );
}
