/**
 * Proxy for Umbra relayer (relayer.umbraprivacy.com).
 * Avoids CSP and CORS by calling the relayer from the server.
 */

const RELAYER_ORIGIN = "https://relayer.umbraprivacy.com";

async function proxy(
  request: Request,
  pathSegments: string[] = []
): Promise<Response> {
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "";
  const url = `${RELAYER_ORIGIN}${path}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (
      key.toLowerCase() !== "host" &&
      key.toLowerCase() !== "connection" &&
      key.toLowerCase() !== "content-length"
    ) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    duplex: "half",
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
  }

  const res = await fetch(url, init);
  const resHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") resHeaders.set(key, value);
  });
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}
