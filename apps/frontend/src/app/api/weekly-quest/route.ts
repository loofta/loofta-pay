import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { awardId } = (await request.json().catch(() => ({}))) as { awardId?: string };
  if (!awardId || !/^[0-9a-f-]{36}$/i.test(awardId)) return NextResponse.json({ error: "awardId required" }, { status: 400 });
  const res = await fetch(`${BACKEND_URL}/weekly-quest/seen`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ awardId }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// The caller's progress in this week's quest. Auth is enforced by the backend (Bearer token).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(`${BACKEND_URL}/weekly-quest/me`, { headers: { Authorization: authHeader }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
