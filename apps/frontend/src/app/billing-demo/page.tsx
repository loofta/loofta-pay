import type { Metadata } from "next";
import BillingDemo from "./BillingDemo";

// Internal sales demo for Loofta Billing: frontend only, sample data. Kept out of search.
export const metadata: Metadata = {
  title: "Loofta Billing demo",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <BillingDemo />;
}
