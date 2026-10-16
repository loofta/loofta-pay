import { NextRequest, NextResponse } from "next/server";

const KINDS = new Set(["email", "username", "twitter", "social"]);
const SOCIAL = new Set(["discord", "github"]);

/**
 * Same-origin proxy for GET /users/pay-target.
 * The browser cannot call Railway directly: production Helmet sets
 * Cross-Origin-Resource-Policy: same-origin and CORS_ORIGIN does not echo
 * the frontend origin, so a 200 from Railway is still a CORS error and the
 * send form treats every recipient as unregistered.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = (searchParams.get("kind") ?? "").trim();
  const value = (searchParams.get("value") ?? "").trim();
  const platform = (searchParams.get("platform") ?? "").trim();
  const empty = { registered: false, requirePrivatePayments: false };

  if (!value || value.length > 200 || !KINDS.has(kind)) {
    return NextResponse.json(empty);
  }
  if (kind === "social" && !SOCIAL.has(platform)) {
    return NextResponse.json(empty);
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const q = new URLSearchParams({ kind, value });
  if (platform) q.set("platform", platform);

  try {
    const r = await fetch(`${backendUrl}/users/pay-target?${q}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json(empty);
    const body = (await r.json()) as Partial<typeof empty>;
    return NextResponse.json({
      registered: !!body.registered,
      requirePrivatePayments: !!body.requirePrivatePayments,
    });
  } catch {
    return NextResponse.json(empty);
  }
}
