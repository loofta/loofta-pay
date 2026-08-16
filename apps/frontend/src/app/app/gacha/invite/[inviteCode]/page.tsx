"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Shareable private-room links intentionally land in the explicit browser flow. That keeps
 * mascot selection and the normal payment confirmation in one place while preserving the
 * invite code in the URL for the room detail, websocket, and join requests.
 */
export default function GachaInvitePage() {
  const params = useParams<{ inviteCode: string }>();
  const router = useRouter();
  const inviteCode = params.inviteCode;

  useEffect(() => {
    if (!inviteCode) return;
    router.replace(`/app/gacha/play?inviteCode=${encodeURIComponent(inviteCode)}`);
  }, [inviteCode, router]);

  return (
    <div className="min-h-screen bg-[#0B0B0F] text-slate-100 flex items-center justify-center text-base font-display">
      Opening private room…
    </div>
  );
}
