import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { SHORT_ID_RE } from '@/lib/shortId';

export default async function ClaimLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;

  if (SHORT_ID_RE.test(id)) {
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

  return <>{children}</>;
}
