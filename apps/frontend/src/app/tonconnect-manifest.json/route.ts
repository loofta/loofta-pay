import { NextResponse } from "next/server";

/**
 * TonConnect's own anti-phishing check compares the manifest's `url` against the actual page
 * origin the connect request came from, and hard-blocks the connection on a mismatch ("The
 * dApp with actual domain X is trying to authorise as Y"). A static /public/tonconnect-manifest.json
 * declaring the production domain works fine in production, but blocks every local dev
 * connection outright since the page is really running on localhost. Serving this dynamically —
 * deriving `url`/`iconUrl` from the actual incoming request's host — keeps both cases correct:
 * production gets a manifest that matches pay.loofta.com, local dev gets one that matches
 * localhost, so a wallet reachable from the dev machine (a browser extension, Telegram Desktop,
 * etc.) can connect. This does not help a *remote* wallet (a phone scanning a QR code) reach a
 * local dev server — that's a separate, unavoidable limitation of testing against localhost at
 * all, not something a manifest can fix.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  return NextResponse.json(
    {
      url: origin,
      name: "Loofta",
      iconUrl: `${origin}/loofta.svg`,
      termsOfUseUrl: "https://loofta.com/terms",
      privacyPolicyUrl: "https://loofta.com/privacy",
    },
    {
      headers: {
        // Same intent as the old static file's default caching, just short enough that an
        // environment change (e.g. a new preview URL) isn't stuck behind a stale response.
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
