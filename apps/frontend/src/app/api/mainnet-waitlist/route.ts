import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      display_name,
      email,
      telegram_handle,
      twitter_username,
      preferred_comms,
      age_range,
      occupation,
      payment_volume,
      payment_type,
      fiat_to_crypto,
      withdrawal_rails,
      earn_interest,
      privy_user_id,
    } = body;

    if (!email && !telegram_handle && !twitter_username) {
      return NextResponse.json(
        { error: "At least one contact method (email, telegram, or twitter) is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // withdrawal_rails arrives as a free-text string from the form; store as a single-element array
    const railsArray = Array.isArray(withdrawal_rails)
      ? withdrawal_rails
      : withdrawal_rails
      ? [withdrawal_rails]
      : [];

    const { data, error } = await supabase
      .from("mainnet_waitlist")
      .insert({
        display_name: display_name || null,
        email: email || null,
        telegram_handle: telegram_handle || null,
        twitter_username: twitter_username || null,
        preferred_comms: preferred_comms || null,
        age_range: age_range || null,
        occupation: occupation || null,
        payment_volume: payment_volume || null,
        payment_type: payment_type || null,
        fiat_to_crypto: fiat_to_crypto ?? false,
        withdrawal_rails: railsArray,
        earn_interest: earn_interest ?? false,
        privy_user_id: privy_user_id || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[mainnet-waitlist] insert error:", error);
      return NextResponse.json({ error: error.message || "Failed to save submission" }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (err: any) {
    console.error("[mainnet-waitlist] unexpected error:", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
