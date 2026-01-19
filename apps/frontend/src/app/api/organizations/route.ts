/**
 * Organizations API
 * 
 * CRUD operations for managing organizations
 * Only accessible by admin user
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isAdmin } from "@/lib/admin";

// Generate random referral code
function generateOrgReferral(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "org_";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper to check admin access
async function checkAdminAccess(request: NextRequest): Promise<{ authorized: boolean; error?: string }> {
  const userId = request.headers.get("x-privy-user-id");
  
  if (!userId) {
    return { authorized: false, error: "No user ID provided" };
  }
  
  const adminStatus = await isAdmin(userId);
  
  if (!adminStatus) {
    return { authorized: false, error: "Unauthorized - Admin access required" };
  }
  
  return { authorized: true };
}

/**
 * GET /api/organizations
 * List all organizations
 */
export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkAdminAccess(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Organizations API] Error fetching organizations:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ organizations: data || [] });
  } catch (error: any) {
    console.error("[Organizations API] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/organizations
 * Create a new organization
 */
export async function POST(request: NextRequest) {
  try {
    const authCheck = await checkAdminAccess(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const body = await request.json();
    const { name, logo_url, checkout_status = "inactive", organization_id } = body;

    if (!name || !organization_id) {
      return NextResponse.json(
        { error: "Missing required fields: name, organization_id" },
        { status: 400 }
      );
    }

    // Generate unique org_referral code
    const org_referral = generateOrgReferral();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("organizations")
      .insert({
        organization_id,
        name,
        logo_url: logo_url || null,
        checkout_status,
        org_referral,
      })
      .select()
      .single();

    if (error) {
      console.error("[Organizations API] Error creating organization:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ organization: data }, { status: 201 });
  } catch (error: any) {
    console.error("[Organizations API] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/organizations
 * Update an organization
 */
export async function PUT(request: NextRequest) {
  try {
    const authCheck = await checkAdminAccess(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, logo_url, checkout_status, organization_id, recipient_wallet, token_symbol, token_chain, bg_color } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const updateData: any = {};
    
    if (name !== undefined) updateData.name = name;
    if (logo_url !== undefined) updateData.logo_url = logo_url;
    if (checkout_status !== undefined) updateData.checkout_status = checkout_status;
    if (organization_id !== undefined) updateData.organization_id = organization_id;
    if (recipient_wallet !== undefined) updateData.recipient_wallet = recipient_wallet || null;
    if (token_symbol !== undefined) updateData.token_symbol = token_symbol || null;
    if (token_chain !== undefined) updateData.token_chain = token_chain || null;
    if (bg_color !== undefined) updateData.bg_color = bg_color || null;

    const { data, error } = await supabase
      .from("organizations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[Organizations API] Error updating organization:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ organization: data });
  } catch (error: any) {
    console.error("[Organizations API] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/organizations
 * Delete an organization
 */
export async function DELETE(request: NextRequest) {
  try {
    const authCheck = await checkAdminAccess(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing required parameter: id" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("organizations")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[Organizations API] Error deleting organization:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Organizations API] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

