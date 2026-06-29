import { NextRequest, NextResponse } from "next/server";

const backendUrl = () =>
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const body = await request.json().catch(() => ({})) as { update_id?: string };
  const updateId = body.update_id ?? "1";

  try {
    const res = await fetch(`${backendUrl()}/users/me/force-update/complete`, {
      method: "POST",
      headers: { authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: updateId }),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
