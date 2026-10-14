import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Same-origin proxy for the Nest API.
 * The page is served from www.loofta.xyz (and pay.loofta.xyz, preview hosts).
 * The browser must not call Railway directly: a missing CORS origin turns a
 * successful response into a CORS error and the UI never sees the JSON.
 * Auth stays on Nest — this forwards the caller's bearer token and does not
 * add one.
 */

function backendOrigin(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
}

const FORWARDED_REQUEST_HEADERS = ["authorization", "content-type", "accept", "x-privy-user-id"];

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (path.length === 0 || path.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }

  const target = new URL(`${backendOrigin()}/${path.map(encodeURIComponent).join("/")}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }

  try {
    const res = await fetch(target, init);
    const out = new Headers();
    const contentType = res.headers.get("content-type");
    if (contentType) out.set("content-type", contentType);
    const cacheControl = res.headers.get("cache-control");
    if (cacheControl) out.set("cache-control", cacheControl);
    return new NextResponse(res.body, { status: res.status, headers: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backend unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
