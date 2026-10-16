import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

async function guard(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) return null;
  return request.headers.get("authorization") ?? "";
}

async function relay(path: string, auth: string, method: string, body?: unknown) {
  const res = await fetch(`${BACKEND_URL}/admin/lottery/${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(request: NextRequest) {
  const auth = await guard(request);
  if (auth === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return relay("weekly-quest", auth, "GET");
}

// PATCH = update settings; POST { awardId } = retry a failed award; POST { userId } = award a qualified user now.
export async function PATCH(request: NextRequest) {
  const auth = await guard(request);
  if (auth === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return relay("weekly-quest/settings", auth, "PATCH", await request.json().catch(() => ({})));
}

export async function POST(request: NextRequest) {
  const auth = await guard(request);
  if (auth === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { awardId, userId } = (await request.json().catch(() => ({}))) as { awardId?: string; userId?: string };
  if (userId) return relay("weekly-quest/award", auth, "POST", { userId });
  if (!awardId || !/^[0-9a-f-]{36}$/i.test(awardId)) return NextResponse.json({ error: "awardId required" }, { status: 400 });
  return relay(`weekly-quest/awards/${awardId}/retry`, auth, "POST", {});
}
