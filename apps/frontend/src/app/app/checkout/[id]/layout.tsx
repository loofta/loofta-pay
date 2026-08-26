import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { SHORT_ID_RE } from '@/lib/shortId';
import { redisIncrWithExpiry } from '@/lib/redis-cache';

// Same short_id -> uuid resolution as /app/c/[id]/layout.tsx, just redirecting to /checkout/{uuid}
// instead of /c/{uuid} so the minimal-chrome page keeps rendering. Not shared as a helper — this
// codebase copy-pastes this kind of route-local lookup rather than extracting it (see
// generateShortId's convention elsewhere).
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default async function CheckoutLayout({
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
    const count = await redisIncrWithExpiry(`rl:checkout-shortid-lookup:${ip}`, RATE_LIMIT_WINDOW_SECONDS);

    if (count <= RATE_LIMIT) {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from('payments')
        .select('id')
        .eq('short_id', id)
        .maybeSingle();

      if (data?.id) {
        redirect(`/checkout/${data.id}`);
      }
    }
  }

  return <>{children}</>;
}
