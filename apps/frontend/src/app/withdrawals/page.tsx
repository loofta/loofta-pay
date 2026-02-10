"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Withdrawal history is now a tab in the Balance modal (header → click balance).
 * Redirect old /withdrawals links to home.
 */
export default function WithdrawalsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-sm text-gray-500">Redirecting…</p>
    </div>
  );
}
