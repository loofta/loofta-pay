import { NextResponse } from "next/server";
import { ONECLICK_BASE, oneClickHeaders } from "../_base";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const addr = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (!/^[\w.:\-]{3,128}$/.test(addr)) return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/status?depositAddress=${encodeURIComponent(addr)}`, { headers: oneClickHeaders(), signal: AbortSignal.timeout(8_000), cache: "no-store" });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ message: "Status unavailable" }, { status: 502 });
  }
}
