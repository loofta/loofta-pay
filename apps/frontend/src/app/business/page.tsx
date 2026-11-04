import { permanentRedirect } from "next/navigation";

// /partners is the one canonical business page; /business just points to it.
export default function Page() {
  permanentRedirect("/partners");
}
