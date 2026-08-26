'use client'

import React from "react";
import { Loader2 } from "lucide-react";
import { ClaimPayView } from "@/app/app/c/[id]/page";

// Minimal-chrome checkout page — same ClaimPayView component /app/c/[id] renders (same balance
// checks, burner resolution, private-transfer math; nothing payment-related is reimplemented
// here), just with chrome="minimal". AppShell already hides the header/footer/bottom-nav for any
// /checkout* path — see isCheckoutPage in components/layout/AppShell.tsx.
function CheckoutPageFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-screen">
      <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      <p className="text-base text-white/40">Loading checkout...</p>
    </div>
  );
}

export default function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return (
    <React.Suspense fallback={<CheckoutPageFallback />}>
      <ClaimPayView claimId={id} chrome="minimal" />
    </React.Suspense>
  );
}
