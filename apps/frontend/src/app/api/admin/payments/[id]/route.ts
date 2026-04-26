import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const VALID_STATUSES = [
  "OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "FUNDED",
  "PRIVATE_TRANSFER_PENDING", "SUCCESS", "REFUNDED",
  "EXPIRED", "CANCELLED", "DELETED",
];

const EDITABLE_FIELDS = ["status", "expires_at", "description", "paid_at", "recipient_address"] as const;

type Props = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest): Promise<string | null> {
  const privyUserId = request.headers.get("x-privy-user-id");
  if (!privyUserId || !(await isAdmin(privyUserId))) return null;
  return privyUserId;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const [
    { data: payment, error: paymentErr },
    { data: intents, error: intentsErr },
    { data: events, error: eventsErr },
  ] = await Promise.all([
    supabase.from("payments").select("*").eq("id", id).single(),
    supabase
      .from("payment_intents")
      .select("*")
      .eq("payment_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payment_events")
      .select("*")
      .eq("payment_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (paymentErr) {
    const status = (paymentErr as any).code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: paymentErr.message }, { status });
  }

  // Fetch user profiles for sender + recipient
  const privyIds = [
    (payment as any).created_by,
    (payment as any).recipient_user_id,
  ].filter(Boolean);

  const userMap: Record<string, any> = {};
  if (privyIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("privy_user_id, username, email, created_at")
      .in("privy_user_id", privyIds);
    for (const u of users ?? []) {
      userMap[(u as any).privy_user_id] = u;
    }
  }

  const p = payment as any;
  return NextResponse.json({
    payment: {
      ...p,
      burner_encrypted_secret: undefined, // never expose
      sender_user: p.created_by ? (userMap[p.created_by] ?? null) : null,
      recipient_user: p.recipient_user_id ? (userMap[p.recipient_user_id] ?? null) : null,
    },
    intents: intents ?? [],
    events: events ?? [],
    _errors: {
      intents: intentsErr?.message ?? null,
      events: eventsErr?.message ?? null,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    if (field === "status") {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 });
      }
    }
    updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("payments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payment: data });
}
