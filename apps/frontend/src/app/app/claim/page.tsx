'use client'

import React from "react";
import { ClaimPageContent } from "./ClaimPageContent";
import { OrganizationClaimPlaceholder } from "./OrganizationClaimPlaceholder";

export default function ClaimPage(props: {
  params?: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = props.searchParams != null ? React.use(props.searchParams) : ({} as Record<string, string | string[] | undefined>);
  const embedInApp = (searchParams && typeof searchParams === "object" && (searchParams as Record<string, string>)["embed"] === "1") ?? false;
  const organizationId = (searchParams as Record<string, string>)?.["organizationId"];
  // pay.loofta.xyz/claim?organizationId=X is reserved for organization payouts — it never falls
  // through to ClaimPageContent's own standalone-route redirect (see ClaimPageContent.tsx:86-90).
  if (organizationId) {
    return <OrganizationClaimPlaceholder organizationId={organizationId} />;
  }
  return <ClaimPageContent embedInApp={embedInApp} />;
}
