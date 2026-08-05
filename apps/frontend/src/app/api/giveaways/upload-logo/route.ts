/**
 * Giveaway project-logo upload — any authenticated user (not admin-only, unlike
 * /api/organizations/upload). The giveaway row doesn't exist yet at wizard-fill time, so this
 * just uploads the file and hands back a public URL for the wizard to include in its own
 * create/edit payload, rather than writing to a DB row itself.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const BUCKET = "logos";

// The organizations upload route (which pioneered this "logos" bucket) has no confirmed caller —
// don't assume the bucket already exists on a fresh project. Same lazy-create pattern as
// /api/giveaways/[id]/og/route.tsx's ensureBucket.
async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data: existing } = await supabase.storage.getBucket(BUCKET);
  if (!existing) {
    await supabase.storage.createBucket(BUCKET, { public: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getVerifiedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing required field: file" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size must be less than 5MB" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileExt = file.name.split(".").pop() || "png";
    const filePath = `giveaways/${userId.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("[Giveaways API] Logo upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return NextResponse.json({ logo_url: urlData.publicUrl });
  } catch (error: any) {
    console.error("[Giveaways API] Logo upload error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
