'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { getLotteryGiftPublic, claimLotteryGift, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { GradientActionButton } from '@/components/ui/GradientActionButton';
import { Loader2, LogIn, CheckCircle2, Ticket, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
        <div className="fixed inset-0 -z-10 bg-[#18181F]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-amber-400" />
              <p className="text-white/80 font-medium">Loading gift…</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#18181F]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertCircle className="h-7 w-7 text-red-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-gray-500">{error || 'This gift link may be invalid.'}</p>
            <Button variant="outline" className="mt-6 rounded-xl" onClick={() => window.history.back()}>
              Go back
            </Button>
          </div>
        </main>
      </>
    );
  }

  const ticketWord = data.numTickets === 1 ? 'ticket' : 'tickets';
  const isClaimed = data.status === 'claimed' || Boolean(claimedTicketId);
  const isUnavailable = data.status === 'cancelled' || data.status === 'failed';
  const canClaim = !isClaimed && !isUnavailable;

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <motion.div
              key={data.status}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-white p-8 shadow-xl"
            >
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
                  <Ticket className="h-7 w-7 text-amber-500" />
                </div>
                <p className="text-4xl font-light tracking-tight text-gray-900 md:text-5xl">
                  {data.numTickets} Megapot {ticketWord}
                </p>
                <p className="mt-2 text-gray-500">Gifted to you — Loofta covers the cost.</p>

                {data.note && (
                  <div className="mt-6 border-t border-gray-100 pt-6">
                    <p className="text-gray-600 text-base leading-relaxed">{data.note}</p>
                  </div>
                )}
              </div>

              {isClaimed && (
                <div className="mt-8 space-y-6">
                  <div className="rounded-xl bg-green-50 p-6 text-center">
                    <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
                    <h2 className="mt-3 text-lg font-semibold text-gray-900">You claimed it!</h2>
                    <p className="mt-1 text-base md:text-sm text-gray-600">
                      Your {ticketWord} are being bought now and will enter the next draw.
                    </p>
                  </div>
                  <GradientActionButton
                    onClick={() => router.push('/app/megapot?tab=history')}
                    className="h-12 w-full rounded-2xl"
                  >
                    <Ticket className="mr-2 h-5 w-5" />
                    View in Megapot
                  </GradientActionButton>
                </div>
              )}

              {isUnavailable && (
                <div className="mt-8 rounded-xl bg-gray-50 p-6 text-center">
                  <p className="font-medium text-gray-700">This gift is no longer available.</p>
                </div>
              )}

              {canClaim && !authenticated && (
                <div className="mt-8 space-y-6">
                  <p className="text-center text-gray-600">
                    Log in with the <strong>{data.recipientType === 'email' ? 'email' : 'X or Loofta'}</strong> account this was sent to. Only that account can claim it.
                  </p>
                  <GradientActionButton onClick={() => login()} className="h-12 w-full rounded-2xl">
                    <LogIn className="mr-2 h-5 w-5" />
                    Log in to claim
                  </GradientActionButton>
                </div>
              )}

              {canClaim && authenticated && (
                <div className="mt-8 space-y-4">
                  <p className="text-center text-base md:text-sm text-gray-500">
                    Claiming buys your {ticketWord} now, so it's ready for the next draw.
                  </p>
                  <GradientActionButton
                    onClick={handleClaim}
                    disabled={claiming}
                    loading={claiming}
                    loadingText="Buying your ticket…"
                    className="h-12 w-full rounded-2xl"
                  >
                    <Ticket className="mr-2 h-5 w-5" />
                    Claim {data.numTickets} {ticketWord}
                  </GradientActionButton>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
