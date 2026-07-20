import type { Metadata } from "next";
import HomeContent from "../HomeContent";

// Archived homepage — the "privacy-first" pitch that `/` used before the
// `/home-v2` "social identity" variant won the A/B test and took over `/`.
// Kept reachable for reference; not indexed and not the canonical URL.
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
  return <HomeContent />;
}
