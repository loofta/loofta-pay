import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await fetch(`${BACKEND_URL}/admin/ample/stakers`, {
    headers: { Authorization: request.headers.get("authorization") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
