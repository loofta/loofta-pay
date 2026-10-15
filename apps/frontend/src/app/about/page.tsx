import type { Metadata } from "next";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import AboutLayout from "./AboutLayout";

export const metadata: Metadata = {
  title: "About Loofta",
  description:
    "Loofta Inc. is a Delaware company building non-custodial payment tools for creators, freelancers and distributed teams. Includes our Terms of Service and Privacy Policy.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <MinimalHeader />
      <AboutLayout />
      <Footer />
    </>
  );
}
