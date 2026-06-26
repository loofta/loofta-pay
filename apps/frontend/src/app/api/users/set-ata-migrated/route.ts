import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const { privyUserId, network, walletAddress, undelegated } = await request.json() as {
      privyUserId?: string;
      network?: string;
      walletAddress?: string;
      undelegated?: boolean;
    };

    if (!privyUserId || (network !== "mainnet" && network !== "devnet")) {
      return NextResponse.json(
        { error: "privyUserId and network ('mainnet' | 'devnet') are required" },
        { status: 400 }
      );
    }

    const column = network === "mainnet" ? "ata_migrated_mainnet" : "ata_migrated_devnet";
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("app_users")
      .update({ [column]: true })
      .eq("privy_user_id", privyUserId);

    if (error) {
      console.error("[set-ata-migrated] Error:", error);
      return NextResponse.json({ error: "Failed to update migration status" }, { status: 500 });
    }

    if (undelegated && walletAddress) {
      console.log(`[ata-migration] ✅ successfully undelegated ${network} ATA for wallet ${walletAddress} (user ${privyUserId})`);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
