import { NextResponse } from "next/server";

const backendUrl = () => process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function fwd(authHeader: string | null): Record<string, string> {
  return authHeader ? { authorization: authHeader } : {};
}

const UNAVAILABLE = { message: "The payment service is unavailable. Try again in a moment." };

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authHeader = request.headers.get("authorization");
  const action = new URL(request.url).searchParams.get("action");
  const path = action === "relay-status" ? `${id}/relay-status` : id;
  try {
    const res = await fetch(`${backendUrl()}/offramp/${path}`, {
      headers: fwd(authHeader),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(UNAVAILABLE, { status: 503 });
  }
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
    action === "relay-tx"        ? "relay-tx"        :
    action === "relay-broadcast" ? "relay-broadcast" :
    action === "delete"         ? "delete"          :
    null;

  if (!endpoint) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // Actions that carry a request body
  const hasBody = ["record-deposit", "bridge-back", "fund-gas", "relay-broadcast"].includes(action);
  const body = hasBody ? await request.text() : undefined;

  try {
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
  } catch {
    return NextResponse.json(UNAVAILABLE, { status: 503 });
  }
}
