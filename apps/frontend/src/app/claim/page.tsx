'use client'

import React from "react";
import { ClaimPageContent } from "./ClaimPageContent";

export default function ClaimPage(props: {
  params?: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = props.searchParams != null ? React.use(props.searchParams) : ({} as Record<string, string | string[] | undefined>);
  const embedInApp = (searchParams && typeof searchParams === "object" && (searchParams as Record<string, string>)["embed"] === "1") ?? false;
  return <ClaimPageContent embedInApp={embedInApp} />;
}
