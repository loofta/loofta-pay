import type { Metadata } from "next";
import { redirect } from "next/navigation";

// home-v3 is the live `/` homepage — keep this route as a stable alias.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  redirect("/");
}
