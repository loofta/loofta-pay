import type { Metadata } from "next";
import HomeV2Content from "./HomeV2Content";

// A/B variant of the homepage — leads with "send by email or @handle" (social
// identity) instead of privacy-first messaging; privacy becomes an optional
// per-payment toggle further down the page. Kept out of search results and
// canonicalized to "/" so it never competes with or duplicates the homepage,
// same pattern as the existing /home-white variant.
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  return <HomeV2Content />;
}
