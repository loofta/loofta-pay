import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function fwd(authHeader: string | null): Record<string, string> {
  return authHeader ? { authorization: authHeader } : {};
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authHeader = request.headers.get("authorization");
  const res = await fetch(`${backendUrl()}/offramp/${id}`, {
    headers: fwd(authHeader),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "";
  const authHeader = request.headers.get("authorization");

  const endpoint =
    action === "confirm-bridge"  ? "confirm-bridge"  :
    action === "record-deposit"  ? "record-deposit"  :
    action === "bridge-back"     ? "bridge-back"     :
    action === "cancel"          ? "cancel"          :
    action === "mark-cancelled"  ? "mark-cancelled"  :
    action === "fund-gas"        ? "fund-gas"        :
    null;

  if (!endpoint) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // Actions that carry a request body
  const hasBody = ["record-deposit", "bridge-back", "fund-gas"].includes(action);
  const body = hasBody ? await request.text() : undefined;

  const res = await fetch(`${backendUrl()}/offramp/${id}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...fwd(authHeader),
    },
    ...(body !== undefined ? { body } : {}),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
