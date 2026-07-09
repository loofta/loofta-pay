'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import { getLotteryGiftPublic, claimLotteryGift, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { Loader2, LogIn, CheckCircle2, Ticket, AlertCircle, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const READY_STATUSES = new Set(['active', 'won', 'lost', 'withdrawn']);

export default function LotteryGiftClaimPage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';
  const router = useRouter();
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { toast } = useToast();

  const [data, setData] = useState<LotteryGiftPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimedTicketId, setClaimedTicketId] = useState<string | null>(null);
  const [ticketReady, setTicketReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Invalid link');
      return;
    }
    getLotteryGiftPublic(token)
      .then(setData)
      .catch((err) => setError(err?.message || 'Link not found'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleClaim = async () => {
    if (!authenticated || !user?.id) {
      login();
      return;
    }
    setClaiming(true);
    try {
      const accessToken = await getAccessToken();
      const result = await claimLotteryGift(token, user.id, accessToken);
      setClaimedTicketId(result.ticketId);
      setData((d) => (d ? { ...d, status: 'claimed' } : null));
      toast({ title: 'Claimed!', description: `${result.numTickets} Megapot ticket${result.numTickets === 1 ? '' : 's'} on the way.` });

      // One status check to inform the message below — not live polling, just enough to tell
      // "ready now" from "still on its way" (bridging a fresh purchase can take a couple minutes).
      try {
        const res = await fetch(`/api/lottery/status/${result.ticketId}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });
        if (res.ok) {
          const status = await res.json();
          setTicketReady(READY_STATUSES.has(status?.status));
        } else {
          setTicketReady(false);
        }
      } catch {
        setTicketReady(false);
      }
    } catch (err: any) {
      toast({
        title: "Couldn't claim",
        description: err?.message || 'Log in with the email, X account, or Loofta username this was sent to.',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-[#FF7A2A]" />
              <p className="text-slate-300 font-medium">Loading gift…</p>
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
            <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
            <p className="mt-2 text-slate-400">{error || 'This gift link may be invalid.'}</p>
            <button
              onClick={() => window.history.back()}
              className="mt-6 h-11 px-6 rounded-xl border border-white/10 text-slate-200 hover:bg-white/[0.06] transition-colors"
            >
              Go back
            </button>
          </div>
        </main>
      </>
    );
  }

  const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
  const isClaimed = data.status === 'claimed' || Boolean(claimedTicketId);
  const isPending = data.status === 'pending_payment';
  const isUnavailable = data.status === 'cancelled' || data.status === 'failed';
  const canClaim = !isClaimed && !isUnavailable && !isPending;

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
      <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <motion.div
              key={data.status}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 space-y-5"
            >
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF7A2A]/15">
                  <Ticket className="h-7 w-7 text-[#FF7A2A]" />
                </div>
                <p className="text-2xl md:text-3xl font-semibold text-white">
                  {data.numTickets} Megapot {ticketWord}
                </p>
                <p className="mt-2 text-slate-400">Gifted to you — Loofta covers the cost.</p>
              </div>

              {data.note && (
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-slate-300 text-base leading-relaxed">{data.note}</p>
                </div>
              )}

              {isClaimed && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-6 text-center">
                    <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
                    <h2 className="mt-3 text-lg font-semibold text-white">You claimed it!</h2>
                    {ticketReady === false && (
                      <p className="mt-2 flex items-center justify-center gap-1.5 text-base text-amber-400">
                        <Clock className="h-4 w-4" /> Still on its way — usually just a couple of minutes.
                      </p>
                    )}
                    <p className="mt-1 text-base text-slate-400">
                      {ticketReady === false
                        ? `Your ${ticketWord} will show up in Megapot once it lands.`
                        : `Your ${ticketWord} are ready and in the next draw.`}
                    </p>
                  </div>
                  <button
                    onClick={() => router.push('/app/megapot?tab=history')}
                    className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Ticket className="w-5 h-5" />
                    View in Megapot
                  </button>
                </div>
              )}

              {isUnavailable && (
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-6 text-center">
                  <p className="font-medium text-slate-300">This gift is no longer available.</p>
                </div>
              )}

              {isPending && (
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-6 text-center flex flex-col items-center gap-2">
                  <Clock className="h-6 w-6 text-amber-400" />
                  <p className="font-medium text-slate-300">This gift is still being set up.</p>
                  <p className="text-sm text-slate-500">Check back in a moment.</p>
                </div>
              )}

              {canClaim && !authenticated && (
                <div className="space-y-4">
                  <p className="text-center text-slate-400">
                    Log in with the <strong className="text-slate-200">{data.recipientType === 'email' ? 'email' : 'X or Loofta'}</strong> account this was sent to. Only that account can claim it.
                  </p>
                  <button
                    onClick={() => login()}
                    className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-5 h-5" />
                    Log in to claim
                  </button>
                </div>
              )}

              {canClaim && authenticated && (
                <div className="space-y-4">
                  <p className="text-center text-base text-slate-500">
                    Claiming buys your {ticketWord} now, so it&apos;s ready for the next draw.
                  </p>
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {claiming ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" /> Buying your {ticketWord}…
                      </>
                    ) : (
                      <>
                        <Ticket className="w-5 h-5" /> Claim {data.numTickets} {ticketWord}
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
