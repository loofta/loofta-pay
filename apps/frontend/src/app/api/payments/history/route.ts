import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const CLAIM_SELECT =
  "id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description";

export type PaymentHistoryClaim = {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_address: string;
  creator_email: string | null;
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
};

export async function GET(request: Request) {
  try {
    const userId = request.headers.get("x-privy-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const walletAddressesParam = searchParams.get("walletAddresses");
    const walletAddresses: string[] = walletAddressesParam
      ? walletAddressesParam.split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    const supabase = getSupabaseAdmin();

    // Sent: claims I created
    const { data: sentRows, error: sentError } = await supabase
      .from("claims")
      .select(CLAIM_SELECT)
      .eq("created_by", userId)
      .order("created_at", { ascending: false });

    if (sentError) {
      console.error("[payments/history] Sent query error:", sentError);
      return NextResponse.json(
        { error: sentError.message },
        { status: 500 }
      );
    }

    let receivedRows: PaymentHistoryClaim[] = [];
    if (walletAddresses.length > 0) {
      const { data: received, error: recError } = await supabase
        .from("claims")
        .select(CLAIM_SELECT)
        .in("recipient_address", walletAddresses)
        .order("created_at", { ascending: false });

      if (recError) {
        console.error("[payments/history] Received query error:", recError);
      } else {
        receivedRows = (received || []) as PaymentHistoryClaim[];
      }
    }

    const sent = (sentRows || []) as PaymentHistoryClaim[];

    return NextResponse.json({
      sent,
      received: receivedRows,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to fetch payment history";
    console.error("[payments/history]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
