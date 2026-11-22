import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ACTIONS = new Set(["approve", "reject", "suspend", "reinstate"]);

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, action } = await ctx.params;
  if (!ACTIONS.has(action) || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${BACKEND_URL}/admin/partners/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: request.headers.get("authorization") ?? "" },
    body: JSON.stringify({ note: typeof body?.note === "string" ? body.note : undefined }),
  });
  const out = await res.json().catch(() => ({}));
  return NextResponse.json(out, { status: res.status });
}
