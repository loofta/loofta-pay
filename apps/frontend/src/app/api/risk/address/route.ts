/**
 * Range address risk check – server-side proxy so API key is never exposed.
 * GET /api/risk/address?address=...&network=solana
 * Returns { safe: boolean, malicious?: boolean, error?: string }
 */

import { NextResponse } from "next/server";

const RANGE_API_BASE = "https://api.range.org/v1";

export async function GET(request: Request) {
  try {
    const apiKey = process.env.RANGE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { safe: true, error: "Risk check not configured" },
        { status: 200 }
      );
    }

    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address")?.trim();
    const network = searchParams.get("network") || "solana";

    if (!address) {
      return NextResponse.json(
        { safe: false, error: "Missing address" },
        { status: 400 }
      );
    }

    const url = `${RANGE_API_BASE}/address?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[Range] Address risk check failed:", res.status, errBody);
      return NextResponse.json(
        { safe: true, error: "Risk check unavailable" },
        { status: 200 }
      );
    }

    const data = (await res.json()) as {
      malicious?: boolean;
      address?: string;
      [key: string]: unknown;
    };

    const malicious = data.malicious === true;
    return NextResponse.json({
      safe: !malicious,
      malicious,
      address: data.address,
    });
  } catch (error) {
    console.error("[Range] Error:", error);
    return NextResponse.json(
      { safe: true, error: "Risk check failed" },
      { status: 200 }
    );
  }
}
