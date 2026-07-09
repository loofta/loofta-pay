'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getLotteryGiftPublic, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { GradientActionButton } from '@/components/ui/GradientActionButton';
import { Ticket, AlertCircle, ArrowDown, Lock, CheckCircle2, ArrowRight } from 'lucide-react';

/**
 * Public preview page — anyone with the link can see "N Megapot tickets, gifted" (mirrors the
 * payment /share/:short_id card: sender/recipient labels either side of the headline figure), no
 * login required. Kept deliberately simple, same as the payment share card — no share/copy
 * affordances here (this page is public) and no note/message (that stays on the gated claim
 * page). The actual claim interaction lives one click away at /gift/:token/claim, matching the
 * payments pattern of /share/:short_id -> /c/:id.
 */
export default function GiftShareClient({ token }: { token: string }) {
  const router = useRouter();
  // On pay.loofta.xyz, proxy.ts rewrites clean paths to /app/* internally but the URL bar (and
  // any link target) must stay clean — only prefix with /app when we're already under /app
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
        <main className="flex flex-col items-center px-4 pt-6 pb-16 min-h-[calc(100vh-5rem)]">
          <div className="w-full max-w-sm space-y-4 animate-pulse">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
              <div className="flex items-center justify-center border-b border-white/[0.06] px-5 py-4">
                <div className="h-4 w-28 rounded-full bg-white/[0.08]" />
              </div>
              <div className="flex flex-col items-center gap-3 px-6 py-7">
                <div className="h-5 w-24 rounded-lg bg-white/[0.08]" />
                <div className="h-16 w-20 rounded-2xl bg-white/[0.08] my-2" />
                <div className="h-5 w-24 rounded-lg bg-white/[0.08]" />
              </div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-5">
              <div className="h-11 w-full rounded-2xl bg-white/[0.08]" />
            </div>
          </div>
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
  const senderLabel = data.senderUsername ? `@${data.senderUsername}` : 'Someone';
  const recipientLabel = data.recipientHandle ? `@${data.recipientHandle}` : 'someone';

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
      <main className="flex flex-col items-center px-4 pt-6 pb-16 min-h-[calc(100vh-5rem)]">
        <div className="w-full max-w-sm space-y-4">
          {/* Card */}
          <div className={`rounded-2xl border overflow-hidden ${isClaimed ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
            <div className="flex items-center justify-center gap-2 border-b border-white/[0.06] px-5 py-4">
              {isClaimed ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Lock className="h-4 w-4 text-white/60" />}
              <span className="text-base font-semibold text-white">{isClaimed ? 'Gift claimed' : 'Gift on Loofta'}</span>
            </div>

            <div className="flex flex-col items-center gap-2 px-6 py-7">
              <span className="text-xl font-bold text-white">{senderLabel}</span>
              <div className="flex flex-col items-center gap-1.5 py-2">
                <ArrowDown className={`h-4 w-4 ${isClaimed ? 'text-emerald-500/40' : 'text-white/20'}`} />
                <span className={`font-display text-5xl font-medium tracking-tight ${isClaimed ? 'text-emerald-400' : 'text-white'}`}>{data.numTickets}</span>
                <span className="text-base md:text-sm text-white/30 font-medium tracking-widest uppercase">Megapot {ticketWord}</span>
                <ArrowDown className={`h-4 w-4 ${isClaimed ? 'text-emerald-500/40' : 'text-white/20'}`} />
              </div>
              <span className="text-xl font-bold text-white">{recipientLabel}</span>
            </div>
          </div>

          {/* CTA card */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 space-y-3">
            <GradientActionButton onClick={() => router.push(claimHref)}>
              <Ticket className="h-4 w-4" />
              {isClaimed ? 'View gift' : 'View & claim gift'}
              <ArrowRight className="h-4 w-4" />
            </GradientActionButton>
          </div>
        </div>
      </main>
    </>
  );
}
