import type { Metadata } from "next";
import BrandContent from "./BrandContent";

export const metadata: Metadata = {
  title: "Brand Assets",
  description: "Official Loofta logos and brand assets for press, partners, and integrations.",
  alternates: {
    canonical: "/brand",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  return <BrandContent />;
}
