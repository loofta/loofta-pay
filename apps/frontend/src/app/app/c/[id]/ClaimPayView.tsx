'use client'

import Link from "next/link";

/**
 * Lightweight wrapper used when embedding the claim view from the home page.
 * Renders a link to the full claim page at /c/[claimId] so the page file
 * does not need to export a named component (Next.js only allows default export).
 */
export function ClaimPayView({ claimId, embedInApp }: { claimId: string; embedInApp?: boolean }) {
  return (
    <div className="space-y-4">
      <p className="text-slate-200 mb-4">
        Payment link created. Share it or open it to view status.
      </p>
      <Link
        href={`/c/${claimId}`}
        className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-6 py-3 text-white font-semibold hover:opacity-90"
      >
        View payment
      </Link>
    </div>
  );
}
