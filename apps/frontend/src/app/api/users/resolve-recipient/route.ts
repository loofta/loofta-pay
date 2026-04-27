import { NextRequest, NextResponse } from "next/server";

/**
 * Resolve recipient (email or username) to Loofta username for /link redirect.
 * GET /api/users/resolve-recipient?q=user@example.com or ?q=username
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ username: null }, { status: 200 });
  }
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  if (q.includes("@") && !q.includes(" ")) {
    const authHeader = request.headers.get("authorization");
    try {
      const r = await fetch(`${backendUrl}/users/by-email?email=${encodeURIComponent(q)}`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.user?.username) {
          return NextResponse.json({ username: data.user.username });
        }
      }
      // 401/404 — not authenticated or email not found, caller handles as claim flow
      return NextResponse.json({ username: null });
    } catch {
      return NextResponse.json({ username: null });
    }
  }
  // Not an email — treat as username
  return NextResponse.json({ username: q.replace(/^@/, "") });
}
