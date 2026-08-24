import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { batchId } = await params;
  const authHeader = request.headers.get("authorization") ?? "";
  const res = await fetch(`${BACKEND_URL}/admin/lottery/subscriptions/batches/${encodeURIComponent(batchId)}/refund`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
