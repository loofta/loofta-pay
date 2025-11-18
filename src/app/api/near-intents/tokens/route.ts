import { NextRequest } from "next/server";
import { NEAR_INTENTS_REMOTE_BASE } from "@/config/nearIntents";
import defaults from "@/config/defaultTokens.json";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.search;
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const remoteUrl = `${NEAR_INTENTS_REMOTE_BASE}/tokens${search || ""}`;
  try {
    const res = await fetch(remoteUrl, {
      // Disable any caching to always reflect latest list
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });
    if (res.ok) {
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          "content-type": res.headers.get("content-type") || "application/json",
        },
      });
    }
    // Non-OK from remote → fall back to defaults with optional client-side filter
    const list = Array.isArray(defaults) ? defaults : [];
    const filtered = q
      ? list.filter((t: any) =>
          `${t.symbol} ${t.name} ${t.chain}`.toLowerCase().includes(q)
        )
      : list;
    return Response.json({ tokens: filtered }, { status: 200 });
  } catch (e: any) {
    // Network error → fall back to defaults
    const list = Array.isArray(defaults) ? defaults : [];
    const filtered = q
      ? list.filter((t: any) =>
          `${t.symbol} ${t.name} ${t.chain}`.toLowerCase().includes(q)
        )
      : list;
    return Response.json({ tokens: filtered }, { status: 200 });
  }
}


