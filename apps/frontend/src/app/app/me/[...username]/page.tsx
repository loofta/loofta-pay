'use client'

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * /me/[@username] redirects to the app Send tab with ?payto=username — a locked-recipient
 * marker (distinct from the generic ?to=/?method= "send again" params) so the Send tab shows
 * a fixed, non-editable recipient instead of the email/social/username picker. Personal links
 * are always tied to one exact account, so there's nothing to pick or mis-route there.
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
    qs.set("payto", cleanUsername);
    if (amountFromQuery != null && amountFromQuery !== "" && !isNaN(Number(amountFromQuery)) && Number(amountFromQuery) >= 0) {
      qs.set("amount", amountFromQuery);
    }
    // "/app" not "/" — on localhost, proxy.ts redirects bare "/" to the marketing /home page
    // and drops the query string in the process; "/app" bypasses that shortcut and resolves to
    // the same app shell on both localhost and pay.loofta.com.
    router.replace(`/app?${qs.toString()}`);
  }, [cleanUsername, amountFromQuery, router]);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] flex items-center justify-center">
      <p className="text-slate-400 text-base md:text-sm">Taking you to Send…</p>
    </div>
  );
}
