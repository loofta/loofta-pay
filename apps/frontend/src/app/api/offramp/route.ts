import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return NextResponse.json(null, { status: 401 });
  const res = await fetch(`${backendUrl()}/offramp/pending`, {
    headers: { authorization: authHeader },
  });
  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}
