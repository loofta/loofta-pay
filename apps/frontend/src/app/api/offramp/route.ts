import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return NextResponse.json(null, { status: 401 });
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("history") === "true" ? "history" : "pending";
  const res = await fetch(`${backendUrl()}/offramp/${path}`, {
    headers: { authorization: authHeader },
  });
  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const body = await request.text();
  const res = await fetch(`${backendUrl()}/offramp/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: authHeader },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
