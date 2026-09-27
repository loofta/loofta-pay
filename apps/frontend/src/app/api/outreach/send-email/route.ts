import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_SUBJECT: Record<string, string> = {
  creator_platform: "Paying your creators across borders",
  giveaway_project: "Your giveaway payouts",
  web3_project:     "Paying your contributors",
  creator:          "Getting paid for your content",
  freelancer:       "Getting paid across borders",
};

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prospectId } = await req.json();
  if (!prospectId) return NextResponse.json({ error: "prospectId required" }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });

  const supabase = getSupabaseAdmin();
  const { data: prospect } = await supabase
    .from("outreach_prospects")
    .select("*")
    .eq("id", prospectId)
    .single();

  if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  if (!["approved", "follow_pending"].includes(prospect.status)) {
    return NextResponse.json({ error: "Prospect must be approved before sending" }, { status: 400 });
  }
  const to = (prospect.email ?? "").trim();
  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: "Prospect has no valid email" }, { status: 400 });

  const message = prospect.final_message ?? prospect.draft_message;
  if (!message) return NextResponse.json({ error: "No message to send" }, { status: 400 });

  const subject = prospect.email_subject?.trim() || DEFAULT_SUBJECT[prospect.type] || "Quick question";
  const from = process.env.OUTREACH_FROM_EMAIL || "Lisa from Loofta <hello@loofta.xyz>";

  // Plain text on purpose: a personal-looking note lands in the inbox far more often than a
  // templated HTML mail. The last line is the opt-out.
  const text = `${message}\n\nLisa, Loofta Pay\nNot the right person or not interested? Just reply and I won't email again.`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, reply_to: from.match(/<(.+)>/)?.[1] ?? from }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[send-email] Resend error:", res.status, body);
      return NextResponse.json({ error: body?.message ?? `Resend ${res.status}` }, { status: 502 });
    }

    const { data: updated } = await supabase
      .from("outreach_prospects")
      .update({ status: "sent", sent_at: new Date().toISOString(), sent_via: "email" })
      .eq("id", prospectId)
      .select("*")
      .single();
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[send-email] error:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Send failed" }, { status: 500 });
  }
}
