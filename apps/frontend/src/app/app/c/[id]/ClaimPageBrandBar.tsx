"use client";

// The small, seamless logo mark shown at the top of /c/[id] now that AppShell suppresses the
// full Loofta nav/header for payment-link pages (see AppShell.tsx isPaymentLinkPage). Renders
// the organization's own logo instead of the Loofta mark when this link was reached via
// /checkout?organizationId=... (propagated here as ?org=).

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { LooftaMark } from "@/components/checkout/MinimalCheckoutShell";
import { getOrganizationByOrganizationId } from "@/services/api/organizations";

export function ClaimPageBrandBar() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("org");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    getOrganizationByOrganizationId(organizationId)
      .then(({ organization }) => {
        setLogoUrl(organization.logo_url);
        setName(organization.name);
      })
      .catch(() => {});
  }, [organizationId]);

  return (
    <div className="w-full flex justify-center pt-4 pb-1">
      {logoUrl ? (
        <Image src={logoUrl} alt={name || "Organization"} width={28} height={28} className="rounded-full object-cover" />
      ) : (
        <LooftaMark className="w-6 h-6" />
      )}
    </div>
  );
}
