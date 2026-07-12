import { NextRequest, NextResponse } from "next/server";
import { redisRPush, redisLRange } from "@/lib/redis-cache";

const LOG_KEY = "astrid-lisa-study:log";
const VISITS_KEY = "astrid-lisa-study:visits";

function parseEntries(raw: string[]) {
  return raw
    .map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const origin =
      request.headers.get("origin") || request.headers.get("referer") || "unknown";

    const entry = {
      timestamp: new Date().toISOString(),
      ip,
      origin,
      answers: body?.answers ?? {},
    };

    await redisRPush(LOG_KEY, JSON.stringify(entry));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to log" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  const adminKey = process.env.ASTRID_STUDY_ADMIN_KEY;
  if (!adminKey || key !== adminKey) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const [rawEntries, rawVisits] = await Promise.all([
      redisLRange(LOG_KEY, 0, -1),
      redisLRange(VISITS_KEY, 0, -1),
    ]);
    return NextResponse.json({
      entries: parseEntries(rawEntries),
      visits: parseEntries(rawVisits),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to read log" }, { status: 500 });
  }
}
