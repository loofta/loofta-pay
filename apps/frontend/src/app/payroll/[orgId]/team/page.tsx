"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

/** Team = contributors list. Redirect to org root which hosts the team UI for now. */
export default function PayrollTeamPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  useEffect(() => {
    if (orgId) window.location.href = `/payroll/${orgId}`;
  }, [orgId]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-gray-500">Redirecting to team…</p>
    </div>
  );
}
