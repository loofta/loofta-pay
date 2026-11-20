import { permanentRedirect } from "next/navigation";

// /partners is merged into /partner, the front door for partners. One page, one address.
export default function Page() {
  permanentRedirect("https://pay.loofta.com/partner");
}
