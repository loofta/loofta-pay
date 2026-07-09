'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getLotteryGiftPublic, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { Loader2, Ticket, AlertCircle, Gift, ArrowRight } from 'lucide-react';

/**
 * Public preview page — anyone with the link can see "N Megapot tickets, gifted" (like the
 * payment /share/:short_id card), no login required. The actual claim interaction (which is
 * gated to the sender/recipient) lives one click away at /gift/:token/claim, matching the
 * payments pattern of /share/:short_id -> /c/:id.
 */
export default function GiftShareClient({ token }: { token: string }) {
  // On pay.loofta.xyz, proxy.ts rewrites clean paths to /app/* internally but the URL bar (and
  // any <Link> target) must stay clean — only prefix with /app when we're already under /app
  // (loofta.xyz or localhost hitting /app/* directly). Same pattern as HistoryTab's megapotBase.
  const isAppPath = usePathname()?.startsWith('/app');
  const claimHref = isAppPath ? `/app/gift/${token}/claim` : `/gift/${token}/claim`;

  const [data, setData] = useState<LotteryGiftPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLotteryGiftPublic(token)
      .then(setData)
      .catch((err) => setError(err?.message || 'Link not found'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <Loader2 className="h-10 w-10 animate-spin text-[#FF7A2A]" />
        </main>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertCircle className="h-7 w-7 text-red-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">Gift not found</h1>
            <p className="mt-2 text-slate-400">This link may be invalid.</p>
          </div>
        </main>
      </>
    );
  }

  const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
  const isClaimed = data.status === 'claimed';

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
      <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FF7A2A]/15">
            <Gift className="h-8 w-8 text-[#FF7A2A]" />
          </div>

          <div>
            <p className="text-3xl md:text-4xl font-semibold text-white">
              {data.numTickets} Megapot {ticketWord}
            </p>
            <p className="mt-2 text-slate-400">
              {isClaimed ? 'This gift has been claimed.' : 'Gifted on Loofta — the cost is already covered.'}
            </p>
          </div>

          {data.note && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-left">
              <p className="text-slate-300 text-base leading-relaxed">{data.note}</p>
            </div>
          )}

          <Link
            href={claimHref}
            className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            <Ticket className="w-5 h-5" />
            View gift
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="text-sm text-slate-500">Only the sender and recipient can claim it.</p>
        </div>
      </main>
    </>
  );
}
