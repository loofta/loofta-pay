import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  const userId = await getVerifiedUserId(request);
  if (!userId) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
  const adminStatus = await isAdmin(userId);
  return NextResponse.json({ isAdmin: adminStatus });
}
