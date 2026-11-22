import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

/** Loofta staff only: the companies that applied for a partner account. */
export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await fetch(`${BACKEND_URL}/admin/partners${request.nextUrl.search}`, {
    headers: { Authorization: request.headers.get("authorization") ?? "" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
