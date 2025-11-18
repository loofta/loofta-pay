import { NextRequest } from "next/server";
import { NEAR_INTENTS_REMOTE_BASE } from "@/config/nearIntents";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch(`${NEAR_INTENTS_REMOTE_BASE}/intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
      },
    });
  } catch (e: any) {
    return Response.json(
      { error: "Failed to create intent", details: e?.message || "unknown" },
      { status: 500 }
    );
  }
}


