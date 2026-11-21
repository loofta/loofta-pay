import { permanentRedirect } from "next/navigation";

// /partner on pay.loofta.com is the one business page; /business just points to it.
export default function Page() {
  permanentRedirect("https://pay.loofta.com/partner");
}
