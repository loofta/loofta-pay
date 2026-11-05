import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public, CORS-open entry to the partner payout portal API for @loofta/portal components that run
 * on a partner's own site. Safe to open to every origin because nothing here is cookie
 * authenticated: every call needs a short-lived portal token (minted by the partner's server) in
 * the Authorization header, and only the two portal endpoints are reachable, not the whole backend.
 */
const ALLOWED: Record<string, string[]> = { me: ["GET"], withdraw: ["POST"] };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function backendOrigin(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const name = path.length === 1 ? path[0] : "";
  if (!ALLOWED[name]?.includes(req.method)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing portal token" }, { status: 401, headers: CORS });
  }

  const init: RequestInit = {
    method: req.method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    cache: "no-store",
  };
  if (req.method === "POST") init.body = await req.text();

  try {
    const res = await fetch(`${backendOrigin()}/portal/${name}`, init);
    return new NextResponse(res.body, {
      status: res.status,
      headers: { ...CORS, "content-type": res.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502, headers: CORS });
  }
}

export const GET = handle;
export const POST = handle;
