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

  const marketingPaths = new Set([
    "/home",
    "/home-white",
    "/brand",
    "/terms",
    "/privacy",
    "/careers",
    "/payment-links",
    "/partners",
    "/guides/send-crypto-privately",
    "/vs/paypal",
    "/astrid-lisa-study",
  ]);
  const isLocalAppPath =
    isLocalhost &&
    !marketingPaths.has(pathname) &&
    !pathname.startsWith("/app");

  // On app domain, redirect /app/* → /* so URLs are always clean
  if (isAppDomain && pathname.startsWith("/app/")) {
    const cleanPath = pathname.slice(4) || "/";
    return NextResponse.redirect(new URL(cleanPath, request.url));
  }

  // Marketing pages (e.g. /partners) linked from within the app must still
  // resolve on pay.loofta.xyz instead of being rewritten to a nonexistent /app/* route.
  if (isAppDomain && marketingPaths.has(pathname)) {
    return NextResponse.next();
  }

  // pay.loofta.xyz or localhost non-marketing path → transparently rewrite to /app/*
  // URL in the browser stays the same; only Next.js routing changes
  if (isAppDomain || isLocalAppPath) {
    // Don't double-prefix: if a link already includes /app (e.g. /app/waitlist from
    // MinimalHeader), keep it as-is rather than producing /app/app/waitlist.
    const appPathname = pathname.startsWith("/app") ? pathname : `/app${pathname === "/" ? "" : pathname}`;
    const rewritten = new URL(appPathname, request.url);
    const response = NextResponse.rewrite(rewritten);

    // Suppress indexing for the secret admin path
    const secretPath = process.env.ADMIN_SECRET_PATH;
    if (secretPath) {
      const adminSegment = `/${secretPath}`;
      if (pathname === adminSegment || pathname.startsWith(`${adminSegment}/`)) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      }
    }

    return response;
  }

  // loofta.xyz → serve marketing pages as-is (root page.tsx)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|images|videos|.*\\..*).*)" ],
};

