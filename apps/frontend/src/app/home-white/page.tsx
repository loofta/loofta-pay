import type { Metadata } from "next";
import HomeWhiteContent from "./HomeWhiteContent";

// Alternate light-theme landing page variant. Kept out of search results and
// canonicalized to "/" so it never competes with or duplicates the homepage.
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
  return <HomeWhiteContent />;
}
