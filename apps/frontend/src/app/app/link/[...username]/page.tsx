'use client'

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Legacy /link/[@username] path, kept so previously shared payment links keep
 * working. Redirects to the current /me/[@username] route.
 */
export default function LegacyLinkPayPage({ params }: { params: Promise<{ username: string[] }> }) {
  const { username: usernameArray } = React.use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const username = usernameArray.join("/");
  const qs = searchParams.toString();

  useEffect(() => {
    router.replace(`/me/${username}${qs ? `?${qs}` : ""}`);
  }, [username, qs, router]);

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] flex items-center justify-center">
      <p className="text-slate-400 text-base md:text-sm">Taking you to Send…</p>
    </div>
  );
}
