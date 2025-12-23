/**
 * Public Organizations API
 * 
 * Public endpoint to fetch organization details by organizationId
 * Used by checkout page (no auth required)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * GET /api/organizations/public?organizationId=xxx
 * Get organization by organizationId (public, no auth required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json(
        { error: "Missing organizationId parameter" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .eq("organization_id", organizationId)
      .single();

    if (error) {
      console.error("[Organizations Public API] Error:", error);
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ organization: data });
  } catch (error: any) {
    console.error("[Organizations Public API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

