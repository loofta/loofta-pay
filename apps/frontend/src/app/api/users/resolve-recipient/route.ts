import { NextResponse } from "next/server";

/**
 * Resolve recipient (email or username) to Loofta username for /link redirect.
 * GET /api/users/resolve-recipient?q=user@example.com or ?q=username
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ username: null }, { status: 200 });
  }
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  // If it looks like an email, try by-email
  if (q.includes("@") && !q.includes(" ")) {
    try {
      const r = await fetch(`${backendUrl}/users/by-email?email=${encodeURIComponent(q)}`);
      if (r.ok) {
        const data = await r.json();
        if (data?.user?.username) {
          return NextResponse.json({ username: data.user.username });
        }
      }
    } catch {
      // ignore
    }
  }
  // Otherwise assume it's a username (caller will redirect to /link/username)
  return NextResponse.json({ username: q.replace(/^@/, "") });
}
