"use client";

// Renders the payment UI in place, at the /checkout URL, for the lifetime of the session — a
// checkout page should stay a checkout page, not bounce the customer to a differently-branded
// /c/[id] "someone sent you money" claim link partway through. That's the one thing reused here:
// ClaimPayView (exported from the /c/[id] route) already has the full any-token/NEAR-Intents/
// privacy payment flow — checkoutMode just hides its "Back to Send" link, which doesn't apply here.

import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { MinimalCheckoutShell } from "@/components/checkout/MinimalCheckoutShell";
import { getOrganizationByOrganizationId, createCheckoutSession, type Organization } from "@/services/api/organizations";
import { ClaimPayView } from "@/app/app/c/[id]/page";

export function CheckoutPageContent({
  organizationId,
  amount,
  description,
  isPrivate,
  callbackUrl,
}: {
  organizationId?: string;
  amount?: string;
  description?: string;
  isPrivate?: boolean;
  callbackUrl?: string;
}) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const amountNum = Number(amount);
    if (!organizationId) {
      setError("Missing organizationId.");
      return;
    }
    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Missing or invalid amount.");
      return;
    }

    (async () => {
      try {
        const { organization } = await getOrganizationByOrganizationId(organizationId);
        setOrg(organization);
        if (organization.checkout_status !== "active") {
          setError("This organization's checkout is not currently active.");
          return;
        }

        const session = await createCheckoutSession(organizationId, {
          amount: amountNum,
          description,
          isPrivate,
          callbackUrl,
        });
        setSessionId(session.id);
      } catch (err: any) {
        setError(err?.message || "Failed to start checkout.");
      }
    })();
  }, [organizationId, amount, description, isPrivate, callbackUrl]);

  return (
    <MinimalCheckoutShell orgLogoUrl={org?.logo_url} orgName={org?.name} bgColor={org?.bg_color}>
      {error ? (
        <div className="flex flex-col items-center gap-3 text-center py-10">
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <p className="text-base text-gray-400">{error}</p>
        </div>
      ) : sessionId ? (
        <ClaimPayView claimId={sessionId} embedInApp checkoutMode />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          <p className="text-base text-gray-500">Starting checkout…</p>
        </div>
      )}
    </MinimalCheckoutShell>
  );
}
