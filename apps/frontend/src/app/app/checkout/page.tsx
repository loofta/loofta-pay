import React from "react";
import { CheckoutPageContent } from "./CheckoutPageContent";

export default function CheckoutPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = props.searchParams != null ? React.use(props.searchParams) : ({} as Record<string, string | string[] | undefined>);
  const get = (key: string) => {
    const v = searchParams[key];
    return typeof v === "string" ? v : undefined;
  };
  return (
    <CheckoutPageContent
      organizationId={get("organizationId")}
      amount={get("amount")}
      description={get("description")}
      isPrivate={get("private") === "1" || get("private") === "true"}
      callbackUrl={get("callbackUrl")}
    />
  );
}
