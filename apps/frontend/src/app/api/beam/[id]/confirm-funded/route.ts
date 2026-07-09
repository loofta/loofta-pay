import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const body = await request.text();
  const res = await fetch(`${backendUrl()}/beam/${id}/confirm-funded`, {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: authHeader },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
