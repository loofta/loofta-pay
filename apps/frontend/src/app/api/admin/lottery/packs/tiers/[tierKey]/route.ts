import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tierKey: string }> }) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tierKey } = await params;
  const body = await request.json().catch(() => ({}));
  const authHeader = request.headers.get("authorization") ?? "";
  const res = await fetch(`${BACKEND_URL}/admin/lottery/packs/tiers/${encodeURIComponent(tierKey)}`, {
    method: "PATCH",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
