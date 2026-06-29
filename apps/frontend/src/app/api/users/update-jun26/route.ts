import { NextRequest, NextResponse } from "next/server";

const backendUrl = () =>
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const updateId = request.nextUrl.searchParams.get("update_id") ?? "1";

  try {
    const res = await fetch(
      `${backendUrl()}/users/me/force-update?update_id=${encodeURIComponent(updateId)}`,
      { headers: { authorization: authHeader } },
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal server error" }, { status: 500 });
  }
}
