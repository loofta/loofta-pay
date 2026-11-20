import { usableJwt } from "@/lib/usableJwt";
export const ONECLICK_BASE = (process.env.ONECLICK_API_BASE || "https://1click.chaindefuser.com").replace(/\/$/, "");

/** The JWT stays on the server. */
export function oneClickHeaders(json = false): Record<string, string> {
  const jwt = usableJwt(process.env.ONECLICK_JWT);
  return { accept: "application/json", ...(json ? { "content-type": "application/json" } : {}), ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) };
}
