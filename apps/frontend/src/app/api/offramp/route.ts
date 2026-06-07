import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const body = await request.json();

  const res = await fetch(`${backendUrl()}/offramp/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
