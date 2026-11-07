import { NextResponse } from "next/server";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";

// Browser quote requests go through here so the 1Click API token stays server-side.
// 1Click only issues confidential quotes to authenticated callers.
const base = process.env.ONECLICK_API_BASE || process.env.NEXT_PUBLIC_ONECLICK_API_BASE || "https://1click.chaindefuser.com";
const jwt = process.env.ONECLICK_JWT || process.env.NEXT_PUBLIC_ONECLICK_JWT;

export async function POST(request: Request) {
  try {
    const req = await request.json();
    if (!req || typeof req.originAsset !== "string" || typeof req.destinationAsset !== "string" || typeof req.amount !== "string") {
      return NextResponse.json({ message: "Invalid quote request" }, { status: 400 });
    }
    OpenAPI.BASE = base;
    if (jwt) OpenAPI.TOKEN = jwt;
    const raw = await OneClickService.getQuote(req as QuoteRequest);
    return NextResponse.json(raw, { status: 200 });
  } catch (e: any) {
    const body = e?.body;
    const message = (typeof body === "object" && body?.message) || e?.message || "Failed to get quote";
    return NextResponse.json({ message }, { status: typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 502 });
  }
}
