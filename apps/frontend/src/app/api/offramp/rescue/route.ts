import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  try {
    const res = await fetch(`${backendUrl()}/offramp/rescue-bridge-back`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeader ? { authorization: authHeader } : {}) },
      body: await request.text(),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "The payment service is unavailable. Try again in a moment." }, { status: 503 });
  }
}
