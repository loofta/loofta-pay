import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

function checkSecret(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.OUTREACH_API_SECRET || process.env.ADMIN_SECRET_PATH;
  return !!secret && !!expected && secret === expected;
}

function extractHandle(raw: string): string | null {
  if (!raw?.trim()) return null;
  // Could be "handle", "@handle", full twitter.com/x.com URL
  const clean = raw.trim()
    .replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "") // strip any trailing path
    .toLowerCase()
    .trim();
  // Reject obviously invalid handles
  if (!clean || clean.length < 2 || clean.length > 50 || /\s/.test(clean)) return null;
  return clean;
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const debug: string[] = [];

  try {
    // Pull all DeFi protocols from DefiLlama (free, no auth required)
    const res = await fetch("https://api.llama.fi/protocols", {
      headers: { "User-Agent": "loofta-outreach/1.0" },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `DefiLlama returned ${res.status}` }, { status: 502 });
    }

    const protocols: any[] = await res.json();
    debug.push(`DefiLlama: ${protocols.length} protocols total`);

    // Filter: on Solana, has a Twitter handle, has some TVL (not dead)
    const solanaWithTwitter = protocols.filter((p) => {
      const chains: string[] = p.chains ?? [];
      const hasSolana = chains.some((c: string) => c.toLowerCase() === "solana");
      const handle = extractHandle(p.twitter ?? "");
      const tvl = p.tvl ?? 0;
      return hasSolana && handle && tvl > 0;
    });
    debug.push(`Solana projects with Twitter + TVL: ${solanaWithTwitter.length}`);

    // Skip known and excluded handles
    const [{ data: existing }, { data: excluded }] = await Promise.all([
      supabase.from("outreach_prospects").select("handle"),
      supabase.from("outreach_excluded_handles").select("handle"),
    ]);
    const knownHandles = new Set([
      ...(existing ?? []).map((r: { handle: string }) => r.handle.toLowerCase()),
      ...(excluded ?? []).map((r: { handle: string }) => r.handle.toLowerCase()),
    ]);
    debug.push(`already known/excluded: ${knownHandles.size}`);

    const toInsert: Array<{
      handle: string;
      bio: string;
      type: "web3_project";
      status: "new";
      followers_count: null;
      profile_image_url: null;
      location: string | null;
    }> = [];

    for (const p of solanaWithTwitter) {
      const handle = extractHandle(p.twitter ?? "");
      if (!handle || knownHandles.has(handle) || handle === "looftapay") continue;

      const tvlFmt = p.tvl >= 1_000_000
        ? `$${(p.tvl / 1_000_000).toFixed(1)}M TVL`
        : `$${(p.tvl / 1_000).toFixed(0)}K TVL`;

      const chains = (p.chains ?? []).slice(0, 4).join(", ");
      const bio = [
        p.name,
        p.category ? `category: ${p.category}` : null,
        tvlFmt,
        chains ? `chains: ${chains}` : null,
        `signal: DefiLlama Solana protocol`,
      ].filter(Boolean).join(" · ").slice(0, 500);

      knownHandles.add(handle);
      toInsert.push({
        handle,
        bio,
        type:             "web3_project",
        status:           "new",
        followers_count:  null,
        profile_image_url: null,
        location:         null,
      });
    }

    debug.push(`new prospects to insert: ${toInsert.length}`);

    if (!toInsert.length) {
      return NextResponse.json({ added: 0, message: "No new DeFi projects found", debug });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("outreach_prospects")
      .insert(toInsert)
      .select("*");

    if (insertError) debug.push(`insert error: ${insertError.message}`);

    return NextResponse.json({
      added:     inserted?.length ?? 0,
      prospects: inserted ?? [],
      debug,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[discover-defi] fatal:", msg);
    return NextResponse.json({ error: msg, debug }, { status: 500 });
  }
}
