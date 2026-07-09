import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return NextResponse.json(null, { status: 401 });
  const res = await fetch(`${backendUrl()}/beam/${id}`, {
    headers: { authorization: authHeader },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
