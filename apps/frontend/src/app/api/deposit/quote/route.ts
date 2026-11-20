import { NextResponse } from "next/server";
import { usableJwt } from "@/lib/usableJwt";

// Browser quote requests go through here so the 1Click API token stays server-side.
// 1Click only issues confidential quotes to authenticated callers.
const base = (process.env.ONECLICK_API_BASE || process.env.NEXT_PUBLIC_ONECLICK_API_BASE || "https://1click.chaindefuser.com").replace(/\/$/, "");

/**
 * Tokens to try in order. A stale or revoked token makes 1Click answer 401 "Invalid token" even for
 * plain quotes that need no auth at all, which broke the Peer deposit while the same quote worked
 * unauthenticated. So each configured token is tried, then no token, before giving up.
 */
function candidateTokens(): (string | undefined)[] {
  const list = [usableJwt(process.env.ONECLICK_JWT)].filter(
    (t, i, a): t is string => !!t && a.indexOf(t) === i,
  );
  return [...list, undefined];
}

export async function POST(request: Request) {
  const req = await request.json().catch(() => null);
  if (!req || typeof req.originAsset !== "string" || typeof req.destinationAsset !== "string" || typeof req.amount !== "string") {
    return NextResponse.json({ message: "Invalid quote request" }, { status: 400 });
  }

  let last: { status: number; message: string } = { status: 502, message: "Failed to get quote" };
  for (const token of candidateTokens()) {
    try {
      const res = await fetch(`${base}/v0/quote`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return NextResponse.json(json, { status: 200 });
      const message = (json as { message?: string })?.message || "Failed to get quote";
      last = { status: res.status >= 400 && res.status < 600 ? res.status : 502, message };
      if (res.status !== 401) break; // only a rejected token is worth retrying with the next one
      console.warn(`[deposit/quote] 1Click rejected ${token ? "a configured token" : "the unauthenticated call"}: ${message}`);
    } catch (e: unknown) {
      last = { status: 502, message: e instanceof Error ? e.message : "Failed to get quote" };
      break;
    }
  }
  return NextResponse.json({ message: last.message }, { status: last.status });
}
