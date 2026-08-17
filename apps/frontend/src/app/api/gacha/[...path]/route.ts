import { NextRequest, NextResponse } from 'next/server';

// Same shape as app/api/lottery/[...path]/route.ts — forwards /api/gacha/* to the backend's
// /gacha/* routes, passing the Authorization header through untouched.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

async function proxyToBackend(req: NextRequest, params: { path: string[] }) {
  const path = params.path.join('/');
  const url = new URL(`${BACKEND_URL}/gacha/${path}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  headers.set('content-type', 'application/json');

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { init.body = await req.text(); } catch { /* no body */ }
  }

  try {
    const res = await fetch(url.toString(), init);
    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    // Nest may intentionally answer a successful lookup with an empty body when its result is
    // null (for example, "no current waiting room"). Preserve that as null. Turning it into an
    // empty object makes consumers mistake `{}` for a real resource and can produce routes such
    // as /app/gacha/undefined.
    const body = await res.text();
    const data = body ? JSON.parse(body) : null;
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(req, await params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(req, await params);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(req, await params);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToBackend(req, await params);
}
