import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD_MARK = "Loofta card";

export async function POST(request: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your email." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await db
    .from("mainnet_waitlist")
    .select("id")
    .eq("email", email)
    .eq("occupation", CARD_MARK)
    .limit(1);
  if (lookupError) {
    return NextResponse.json({ error: "Could not save your application. Try again." }, { status: 500 });
  }
  if (!existing?.length) {
    const { error } = await db.from("mainnet_waitlist").insert({
      email,
      occupation: CARD_MARK,
      payment_type: "card_early_access",
    });
    if (error) {
      return NextResponse.json({ error: "Could not save your application. Try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
