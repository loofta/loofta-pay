import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { SHORT_ID_RE } from '@/lib/shortId';
import { redisIncrWithExpiry } from '@/lib/redis-cache';

// This lookup runs unauthenticated, ahead of the already-rate-limited /api/claims/[id] route —
// capping it defensively (not because ~47.6 bits of short_id entropy is practically
// brute-forceable today, but because this becomes public infra's front door and an uncapped
// unauthenticated DB query per request is a needless cost/enumeration surface at real traffic
// volume). Fails open on a Redis hiccup, same convention as the rest of redis-cache.ts.
// 20/min per IP: generous enough for a shared office/NAT IP with a few people opening claim
// links around the same time plus reloads/retries, without leaving the door wide open.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default async function ClaimLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;

  if (SHORT_ID_RE.test(id)) {
    const hdrs = await headers();
    const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const count = await redisIncrWithExpiry(`rl:claim-shortid-lookup:${ip}`, RATE_LIMIT_WINDOW_SECONDS);

    if (count <= RATE_LIMIT) {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from('payments')
        .select('id')
        .eq('short_id', id)
        .maybeSingle();

      if (data?.id) {
        redirect(`/c/${data.id}`);
      }
      // If no payment found for this short code, fall through to the 404 in page.tsx
    }
    // Over the limit: skip the lookup and fall through — same 404 experience as a bad short_id,
    // rather than surfacing a 429 that would just invite retries.
  }

  return <>{children}</>;
}
