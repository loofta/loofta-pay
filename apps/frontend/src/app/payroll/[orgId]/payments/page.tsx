"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Redirect to Pay (deal payments are now under Pay). */
export default function PaymentsRedirectPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const router = useRouter();

  useEffect(() => {
    if (orgId) router.replace(`/payroll/${orgId}/pay`);
  }, [orgId, router]);

  return null;
}
