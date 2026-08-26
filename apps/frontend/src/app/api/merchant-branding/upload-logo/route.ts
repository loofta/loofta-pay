/**
 * Merchant branding logo upload (Developer settings -> Branding). Unlike the giveaway logo
 * upload, this one runs every image through sharp first: merchants paste in whatever aspect
 * ratio their source logo happens to be, but it's displayed everywhere (checkout header,
 * Developer settings preview) as a circular avatar, so a non-square source would get an
 * off-center or stretched crop client-side. Cropping to a true square server-side once, at
 * upload time, means every consumer can just apply object-cover + rounded-full and get a clean
 * result regardless of what the merchant uploaded.
 */
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const SQUARE_SIZE = 512;
const BUCKET = "logos";

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
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: "File size must be less than 5MB" }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    let outputBuffer: Buffer;
    try {
      outputBuffer = await sharp(inputBuffer)
        .rotate() // apply EXIF orientation before stripping metadata
        .resize({ width: SQUARE_SIZE, height: SQUARE_SIZE, fit: "cover", position: "centre" })
        .png({ compressionLevel: 8 }) // preserves transparency — logos are shown over both light and dark backgrounds
        .toBuffer();
    } catch (compressError) {
      console.error("[Merchant branding] Logo processing error:", compressError);
      return NextResponse.json({ error: "Could not process this image — try a different file" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);
    const filePath = `merchant-branding/${userId.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}.png`;

    // See /api/giveaways/upload-proof for why the Blob wrapper is required on Vercel.
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, new Blob([Uint8Array.from(outputBuffer)], { type: "image/png" }), { contentType: "image/png", upsert: false });
    if (uploadError) {
      console.error("[Merchant branding] Logo upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return NextResponse.json({ logo_url: urlData.publicUrl });
  } catch (error: any) {
    console.error("[Merchant branding] Logo upload error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
