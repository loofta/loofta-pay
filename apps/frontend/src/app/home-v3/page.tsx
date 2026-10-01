import type { Metadata } from "next";
import HomeV3Content from "./HomeV3Content";

// Draft homepage for review — not the live "/" yet (see ../home-v2/HomeV2Content.tsx, which
// still serves "/"). Kept out of search results while it's being validated.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  return <HomeV3Content />;
}
