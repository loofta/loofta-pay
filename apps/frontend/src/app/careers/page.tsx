import type { Metadata } from "next";
import CareersContent from "./CareersContent";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Join Loofta and help build the future of private crypto payments. Open roles for engineers and operators working on non-custodial, privacy-preserving payment infrastructure.",
  alternates: {
    canonical: "/careers",
  },
};

export default function Page() {
  return <CareersContent />;
}
