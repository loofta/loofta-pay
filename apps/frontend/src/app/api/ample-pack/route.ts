import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

// The caller's free Ample pack. Auth is enforced by the backend (Bearer token).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(`${BACKEND_URL}/ample/pack`, { headers: { Authorization: authHeader }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { packId } = (await request.json().catch(() => ({}))) as { packId?: string };
  if (!packId || !/^[\w-]{1,120}$/.test(packId)) return NextResponse.json({ error: "packId required" }, { status: 400 });
  const res = await fetch(`${BACKEND_URL}/ample/pack/${encodeURIComponent(packId)}/open`, { method: "POST", headers: { Authorization: authHeader, "Content-Type": "application/json" }, body: "{}" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
