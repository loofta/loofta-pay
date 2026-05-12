'use server'

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ short_id: string }> },
) {
  const { short_id } = await params
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('twitter_payment_requests')
    .select(
      'short_id, sender_twitter, recipient_twitter, amount_usd, status, payment_id, is_devnet, created_at, expires_at',
    )
    .eq('short_id', short_id)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}
