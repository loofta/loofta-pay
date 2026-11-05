import { NextRequest, NextResponse } from "next/server";

// PoolRip runs as its own server but logs in with this same Privy app, so the user's Privy bearer token is valid
// there as-is. The browser talks to this route (same origin) and we forward only the few calls the seat upsell needs.
const POOLRIP_API_URL = (process.env.POOLRIP_API_URL || "").replace(/\/+$/, "");

const ALLOWED: Array<{ method: string; re: RegExp }> = [
  { method: "GET", re: /^config$/ },
  { method: "GET", re: /^lobby$/ },
  { method: "GET", re: /^pools\/[0-9a-f-]{36}$/i },
  { method: "POST", re: /^lanes\/(death|collab)-25\/join-tx$/ },
  { method: "POST", re: /^lanes\/(death|collab)-25\/join$/ },
  { method: "POST", re: /^holds\/[0-9a-f-]{36}\/release$/i },
  { method: "PUT", re: /^pools\/[0-9a-f-]{36}\/prevote$/i },
];

async function forward(request: NextRequest, path: string[]) {
  if (!POOLRIP_API_URL) return NextResponse.json({ error: "PoolRip is not configured" }, { status: 503 });
  const sub = path.join("/");
  if (!ALLOWED.some((a) => a.method === request.method && a.re.test(sub))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (request.method !== "GET" && !authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hasBody = request.method !== "GET";
  const res = await fetch(`${POOLRIP_API_URL}/api/${sub}`, {
    method: request.method,
    headers: { ...(authHeader ? { Authorization: authHeader } : {}), "Content-Type": "application/json" },
    body: hasBody ? JSON.stringify(await request.json().catch(() => ({}))) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: "PoolRip is unreachable right now" }, { status: 502 });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, ctx: Ctx) { return forward(request, (await ctx.params).path); }
export async function POST(request: NextRequest, ctx: Ctx) { return forward(request, (await ctx.params).path); }
export async function PUT(request: NextRequest, ctx: Ctx) { return forward(request, (await ctx.params).path); }
