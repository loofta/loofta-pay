import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

async function authorize(request: NextRequest): Promise<NextResponse | null> {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/** Loofta staff only: Loofta's own fee on every partner withdrawal. */
export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const res = await fetch(`${BACKEND_URL}/admin/partners/loofta-fee`, {
    headers: { Authorization: request.headers.get("authorization") ?? "" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function PUT(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const input = await request.json().catch(() => ({}));
  const flat = Number(input?.flat_usd);
  const bps = Number(input?.bps);
  const res = await fetch(`${BACKEND_URL}/admin/partners/loofta-fee`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
    body: JSON.stringify({ flat_usd: flat, bps }),
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
