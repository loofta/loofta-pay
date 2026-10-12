import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(_request: Request, props: { params: Promise<{ shortId: string }> }) {
  const { shortId } = await props.params;
  const res = await fetch(`${backendUrl()}/offramp/public/${encodeURIComponent(shortId)}`);
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
