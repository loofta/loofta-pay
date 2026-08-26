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

  // loofta.com exists solely to host the Telegram Connect widget — Privy/Telegram's login
  // widget doesn't work on .xyz domains, so this relay domain hands the handle back to
  // pay.loofta.xyz via a one-time token (see telegram-relay/page.tsx + api/telegram-relay).
  // Now that this domain's DNS actually resolves to this deployment (previously it pointed
  // elsewhere), every other route on it — the marketing site, the app, etc. — is technically
  // reachable here too. That's not intentional: redirect anything but the relay path itself back
  // to the canonical app domain instead of silently duplicate-serving it on loofta.com.
  const isTelegramRelayDomain = hostname === "loofta.com" || hostname === "www.loofta.com";
  if (isTelegramRelayDomain) {
    if (pathname === "/telegram-relay") {
      const rewritten = new URL(`/telegram-relay${request.nextUrl.search}`, request.url);
      return NextResponse.rewrite(rewritten);
    }
    return NextResponse.redirect(new URL(`${pathname}${request.nextUrl.search}`, "https://pay.loofta.xyz"));
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
    "/home-v2",
    "/home-classic",
    "/brand",
    "/terms",
    "/privacy",
    "/careers",
    "/payment-links",
    "/pay-with-email",
    "/partners",
    "/guides/send-crypto-privately",
    "/vs/paypal",
    "/usdc-to-ngn",
    "/dollar-to-naira-today",
    "/blog",
    "/docs",
  ]);
  // /blog/[slug] and /docs/[slug] are dynamic, so the exact-match Set above can't cover their
  // sub-pages — treat any path under either as marketing too, same as their index page.
  const isMarketingPath = (p: string) => marketingPaths.has(p) || p.startsWith("/blog/") || p.startsWith("/docs/");
  const isLocalAppPath =
    isLocalhost &&
    !isMarketingPath(pathname) &&
    !pathname.startsWith("/app");

  // App-only kill switch: set MAINTENANCE_MODE=true on Railway/Vercel to rewrite the
  // app (pay.loofta.xyz, or its localhost equivalent) to the maintenance screen. Marketing
  // pages — loofta.xyz, and marketing paths mirrored onto the app domain — stay untouched.
  const isMaintenanceModeOn = process.env.MAINTENANCE_MODE?.trim().toLowerCase() === "true";
  if (
    isMaintenanceModeOn &&
    (isAppDomain || isLocalAppPath) &&
    !isMarketingPath(pathname) &&
    pathname !== "/maintenance"
  ) {
    return NextResponse.rewrite(new URL("/maintenance", request.url));
  }

  // On app domain, redirect /app/* → /* so URLs are always clean
  if (isAppDomain && pathname.startsWith("/app/")) {
    const cleanPath = pathname.slice(4) || "/";
    return NextResponse.redirect(new URL(cleanPath, request.url));
  }

  // Marketing pages (e.g. /partners) linked from within the app must still
  // resolve on pay.loofta.xyz instead of being rewritten to a nonexistent /app/* route.
  if (isAppDomain && isMarketingPath(pathname)) {
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

