import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/services/api/client";

/** Proxy POST onboard (set wallet + optional username) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const body = await req.json();
  const res = await fetch(
    `${BACKEND_URL}/payroll/invite/${encodeURIComponent(token)}/onboard`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}
