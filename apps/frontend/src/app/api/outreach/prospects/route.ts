import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_SECRET_PATH;
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_prospects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[outreach/prospects] Supabase error:", error.message, error.code);
      // Table may not exist yet — return empty list so UI still loads
      return NextResponse.json({ prospects: [] });
    }
    return NextResponse.json({ prospects: data ?? [] });
  } catch (err) {
    console.error("[outreach/prospects] GET threw:", err);
    return NextResponse.json({ prospects: [] });
  }
}

// PATCH — bulk approve: { ids: string[], status: "approved", final_messages?: Record<id, string> }
export async function PATCH(req: NextRequest) {
  if (!checkSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { ids, final_messages } = await req.json() as { ids: string[]; final_messages?: Record<string, string> };
    if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
    const supabase = getSupabaseAdmin();

    if (final_messages && Object.keys(final_messages).length) {
      // Per-row final_message: update each row individually but in parallel via Promise.all
      const results = await Promise.all(
        ids.map((id) =>
          supabase
            .from("outreach_prospects")
            .update({ status: "approved", final_message: final_messages[id] ?? null })
            .eq("id", id)
            .select("*")
            .single()
            .then(({ data }) => data),
        ),
      );
      return NextResponse.json({ prospects: results.filter(Boolean) });
    }

    // No per-row message — single DB call
    const { data, error } = await supabase
      .from("outreach_prospects")
      .update({ status: "approved" })
      .in("id", ids)
      .select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ prospects: data ?? [] });
  } catch (err: any) {
    console.error("[outreach/prospects] PATCH threw:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { handle, bio, type } = await req.json();
    if (!handle?.trim()) {
      return NextResponse.json({ error: "handle is required" }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, "").trim().toLowerCase();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outreach_prospects")
      .insert({ handle: cleanHandle, bio: bio ?? "", type: type ?? "individual" })
      .select("*")
      .single();
    if (error) {
      console.error("[outreach/prospects] POST insert error:", error.message, error.code);
      if (error.code === "23505") {
        return NextResponse.json({ error: `@${cleanHandle} is already in the queue` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[outreach/prospects] POST threw:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
