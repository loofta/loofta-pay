/**
 * Giveaway task-completion proof upload (screenshot/image) — any authenticated user, same shape
 * as /api/giveaways/upload-logo. Every image is re-encoded through sharp to a bounded max
 * dimension + JPEG quality before it ever reaches storage: a raw phone screenshot can be
 * several MB, and with one require_proof task potentially collecting one image per entrant per
 * giveaway, uncompressed uploads would scale storage cost with entry volume for no benefit — the
 * review UI only needs the proof legible, not full-resolution.
 */
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

const MAX_UPLOAD_SIZE = 8 * 1024 * 1024; // pre-compression cap on what we'll even try to process
const MAX_DIMENSION = 1600; // longest edge, px — plenty to read a screenshot, far below a raw photo
const JPEG_QUALITY = 70;
const BUCKET = "task-proofs";

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
      return NextResponse.json({ error: "File size must be less than 8MB" }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    let outputBuffer: Buffer;
    try {
      outputBuffer = await sharp(inputBuffer)
        .rotate() // apply EXIF orientation before stripping metadata
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch (compressError) {
      console.error("[Giveaways API] Proof image compression error:", compressError);
      return NextResponse.json({ error: "Could not process this image — try a different file" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);
    const filePath = `task-proofs/${userId.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}.jpg`;

    // sharp's .toBuffer() returns a Buffer backed by native (libvips) memory, not a plain JS-heap
    // ArrayBuffer. Passed straight to supabase-js's upload(), Vercel's runtime throws
    // "ArrayBuffer: SharedArrayBuffer is not allowed" (confirmed in prod logs 2026-08-11) — it
    // misidentifies that native-backed buffer as a SharedArrayBuffer. Wrapping in a Blob forces a
    // copy into a normal, owned buffer before it reaches the upload call.
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, new Blob([Uint8Array.from(outputBuffer)], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      console.error("[Giveaways API] Proof upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return NextResponse.json({ proof_url: urlData.publicUrl });
  } catch (error: any) {
    console.error("[Giveaways API] Proof upload error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
