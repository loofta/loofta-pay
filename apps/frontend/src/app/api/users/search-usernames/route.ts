import { NextResponse } from "next/server";

const CACHE_MAX_AGE = 60; // 1 min browser cache

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ usernames: [] }, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${CACHE_MAX_AGE}` },
    });
  }
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  try {
    const r = await fetch(`${backendUrl}/users/search?q=${encodeURIComponent(q)}`, {
      headers: { "Accept": "application/json" },
    });
    if (!r.ok) {
      return NextResponse.json({ usernames: [] }, { status: 200 });
    }
    const data = await r.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": `public, max-age=${CACHE_MAX_AGE}` },
    });
  } catch {
    return NextResponse.json({ usernames: [] }, { status: 200 });
  }
}
