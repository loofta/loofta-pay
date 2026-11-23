import { headers } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";

// /partners is merged into /partner, the front door for partners. One page, one address.
// On a developer machine it must stay on that machine: a hard-coded production address once sent local testing to the live site.
export default async function Page() {
  const host = ((await headers()).get("host") ?? "").toLowerCase();
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.endsWith(".local")) redirect("/partner");
  permanentRedirect("https://pay.loofta.com/partner");
}
