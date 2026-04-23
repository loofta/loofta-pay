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

  const isLocalhost =
    hostname === "localhost" || hostname.startsWith("localhost:");

  // On localhost, / clashes with the app shell — push it to /home instead
  if (isLocalhost && pathname === "/") {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  const marketingPaths = new Set(["/home", "/home-white", "/brand"]);
  const isLocalAppPath =
    isLocalhost &&
    !marketingPaths.has(pathname) &&
    !pathname.startsWith("/app");

  // pay.loofta.xyz or localhost non-marketing path → transparently rewrite to /app/*
  // URL in the browser stays the same; only Next.js routing changes
  if (isAppDomain || isLocalAppPath) {
    const rewritten = new URL(
      `/app${pathname === "/" ? "" : pathname}`,
      request.url
    );
    return NextResponse.rewrite(rewritten);
  }

  // loofta.xyz → serve marketing pages as-is (root page.tsx)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|images|videos|.*\\..*).*)" ],
};

