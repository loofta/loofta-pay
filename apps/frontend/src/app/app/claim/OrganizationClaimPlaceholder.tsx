"use client";

// Scaffolds the pay.loofta.xyz/claim?organizationId=X route contract for organization payouts.
// Full content lands in phase 2 once the send-payout SDK can actually create these — for now
// this just confirms the branded route resolves instead of colliding with the standalone
// /claim redirect (which only fires when organizationId is absent, see page.tsx).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MinimalCheckoutShell } from "@/components/checkout/MinimalCheckoutShell";
import { getOrganizationByOrganizationId, type Organization } from "@/services/api/organizations";

export function OrganizationClaimPlaceholder({ organizationId }: { organizationId: string }) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrganizationByOrganizationId(organizationId)
      .then(({ organization }) => setOrg(organization))
      .catch(() => setOrg(null))
      .finally(() => setLoading(false));
  }, [organizationId]);

  return (
    <MinimalCheckoutShell orgLogoUrl={org?.logo_url} orgName={org?.name} bgColor={org?.bg_color}>
      <div className="flex flex-col items-center gap-3 text-center py-10">
        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        ) : (
          <>
            <p className="text-lg font-medium text-gray-200">
              {org?.name ? `Payout from ${org.name}` : "Organization payout"}
            </p>
            <p className="text-base text-gray-500 max-w-xs">
              This payout link isn&apos;t claimable yet — check back soon.
            </p>
          </>
        )}
      </div>
    </MinimalCheckoutShell>
  );
}
