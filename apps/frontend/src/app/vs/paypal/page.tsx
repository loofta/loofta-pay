import type { Metadata } from "next";
import PaypalComparisonContent from "./PaypalComparisonContent";

export const metadata: Metadata = {
  title: "Loofta vs PayPal — A Private Way for Freelancers to Get Paid",
  description:
    "Compare Loofta to PayPal for freelancers and creators: fees, settlement speed, availability, and who gets to see your payment history. A private alternative to PayPal for getting paid in crypto.",
  alternates: {
    canonical: "/vs/paypal",
  },
};

export default function Page() {
  return <PaypalComparisonContent />;
}
