import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/services/api/client";

/** Proxy GET invite by token (public) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const res = await fetch(`${BACKEND_URL}/payroll/invite/${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}
