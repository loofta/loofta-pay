/**
 * Organization Logo Upload API
 * 
 * Handles logo uploads for organizations
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isAdmin } from "@/lib/admin";

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
 * POST /api/organizations/upload
 * Upload organization logo
 */
export async function POST(request: NextRequest) {
  try {
    const authCheck = await checkAdminAccess(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const organizationId = formData.get("organizationId") as string;

    if (!file || !organizationId) {
      return NextResponse.json(
        { error: "Missing required fields: file, organizationId" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File size must be less than 5MB" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    
    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Generate unique filename
    const fileExt = file.name.split(".").pop();
    const fileName = `${organizationId}_${Date.now()}.${fileExt}`;
    const filePath = `organizations/${fileName}`;

    // Upload to Supabase Storage (you'll need to create a 'logos' bucket)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("logos")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[Organizations API] Upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("logos")
      .getPublicUrl(filePath);

    const logoUrl = urlData.publicUrl;

    // Update organization with logo URL
    const { data: orgData, error: updateError } = await supabase
      .from("organizations")
      .update({ logo_url: logoUrl })
      .eq("organization_id", organizationId)
      .select()
      .single();

    if (updateError) {
      console.error("[Organizations API] Update error:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      logo_url: logoUrl,
      organization: orgData 
    });
  } catch (error: any) {
    console.error("[Organizations API] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

