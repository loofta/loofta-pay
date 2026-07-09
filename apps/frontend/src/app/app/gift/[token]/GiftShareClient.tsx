'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getLotteryGiftPublic, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { DescriptionWithGif } from '@/components/DescriptionWithGif';
import { GradientActionButton } from '@/components/ui/GradientActionButton';
import { ShareLinkMenu } from '@/components/ShareLinkMenu';
import { Loader2, Ticket, AlertCircle, Gift, ArrowDown, Lock, CheckCircle2, ArrowRight, Copy } from 'lucide-react';

const SITE_URL = 'https://pay.loofta.xyz';

/**
 * Public preview page — anyone with the link can see "N Megapot tickets, gifted" (mirrors the
 * payment /share/:short_id card: sender/recipient labels either side of the headline figure), no
 * login required. The actual claim interaction (gated to the sender/recipient) lives one click
 * away at /gift/:token/claim, matching the payments pattern of /share/:short_id -> /c/:id.
 */
export default function GiftShareClient({ token }: { token: string }) {
  const router = useRouter();
  // On pay.loofta.xyz, proxy.ts rewrites clean paths to /app/* internally but the URL bar (and
  // any link target) must stay clean — only prefix with /app when we're already under /app
  // (loofta.xyz or localhost hitting /app/* directly). Same pattern as HistoryTab's megapotBase.
  const isAppPath = usePathname()?.startsWith('/app');
  const claimHref = isAppPath ? `/app/gift/${token}/claim` : `/gift/${token}/claim`;
  const shareUrl = `${SITE_URL}/gift/${token}`;

  const [data, setData] = useState<LotteryGiftPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  const senderLabel = data.senderUsername ? `@${data.senderUsername}` : 'Someone';
  const recipientLabel = data.recipientHandle ? `@${data.recipientHandle}` : 'someone';
  const shareText = isClaimed
    ? `${senderLabel} gifted ${data.numTickets} Megapot ${ticketWord} on Loofta 🎟️`
    : `I gifted ${data.numTickets} Megapot ${ticketWord} on Loofta 🎟️`;

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
                <span className={`text-5xl font-bold tracking-tight ${isClaimed ? 'text-emerald-400' : 'text-white'}`}>{data.numTickets}</span>
                <span className="text-base md:text-sm text-white/30 font-medium tracking-widest uppercase">Megapot {ticketWord}</span>
                <ArrowDown className={`h-4 w-4 ${isClaimed ? 'text-emerald-500/40' : 'text-white/20'}`} />
              </div>
              <span className="text-xl font-bold text-white">{recipientLabel}</span>
            </div>

            {data.note && (
              <div className="border-t border-white/[0.06] px-5 py-4">
                <DescriptionWithGif text={data.note} />
              </div>
            )}
          </div>

          {/* CTA card */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 space-y-3">
            <GradientActionButton onClick={() => router.push(claimHref)}>
              <Ticket className="h-4 w-4" />
              {isClaimed ? 'View gift' : 'View & claim gift'}
              <ArrowRight className="h-4 w-4" />
            </GradientActionButton>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 flex-1 min-w-0">
                <span className="flex-1 min-w-0 truncate text-base text-slate-300">{shareUrl}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label="Copy share link"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <ShareLinkMenu
                url={shareUrl}
                title="Megapot ticket gift"
                text={shareText}
                ogUrl={`${SITE_URL}/api/gift/${token}/og`}
              />
            </div>
            <p className="text-center text-sm text-slate-500 flex items-center justify-center gap-1.5">
              <Gift className="w-3.5 h-3.5" /> Only the sender and recipient can claim it.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
