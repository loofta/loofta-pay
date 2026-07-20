import type { Metadata } from "next";
import HomeV2Content from "./HomeV2Content";

// This variant won the A/B test against the old privacy-first homepage and is
// now also served at "/" (see ../page.tsx). This route is kept only so the old
// /home-v2 link doesn't 404; canonicalized to "/" and out of search results so
// it never competes with the real homepage.
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
