import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;

  // Let Next.js internals, static assets, and API routes pass through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/videos") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isAppDomain =
    hostname === "pay.loofta.xyz" ||
    hostname.startsWith("pay.");

  // pay.loofta.xyz → transparently rewrite to /app/*
  // URL in the browser stays the same; only Next.js routing changes
  if (isAppDomain) {
    const rewritten = new URL(
      `/app${pathname === "/" ? "" : pathname}`,
      request.url
    );
    return NextResponse.rewrite(rewritten);
  }

  // loofta.xyz → serve marketing pages as-is (root page.tsx)
  return NextResponse.next();
}

