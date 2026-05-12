'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  getSendPaymentPublic,
  claimSendPayment,
  reclaimSendPayment,
  type SendPaymentLinkPublic,
} from '@/services/api/sendPayment';
import { GradientActionButton } from '@/components/ui/GradientActionButton';
import { Loader2, LogIn, CheckCircle2, Wallet, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/** Parse message that may contain text + a trailing image/GIF URL (e.g. from send form). */
function parseMessageWithMedia(message: string | null | undefined): { text: string; imageUrl: string | null } {
  if (!message?.trim()) return { text: '', imageUrl: null };
  const trimmed = message.trim();
  const urlLike = /https?:\/\/[^\s]+/gi;
  const matches = trimmed.match(urlLike) || [];
  const imageExtensions = /\.(gif|gifv|webp|jpg|jpeg|png)(\?.*)?$/i;
  const imageHosts = /\.(giphy\.com|tenor\.com|gfycat\.com|media\.giphy|i\.giphy)/i;
  let imageUrl: string | null = null;
  let text = trimmed;
  for (const rawUrl of matches) {
    const clean = rawUrl.replace(/[.,)]+$/, '');
    if (imageExtensions.test(clean) || imageHosts.test(clean)) {
      imageUrl = clean;
      text = trimmed.replace(rawUrl, '').replace(clean, '').trim().replace(/\s+/g, ' ').trim();
      break;
    }
  }
  return { text, imageUrl };
}

export default function SendPaymentClaimPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user, authenticated, login } = usePrivy();
  const { toast } = useToast();
  const [data, setData] = useState<SendPaymentLinkPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [reclaimed, setReclaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Invalid link');
      return;
    }
    const userId = authenticated && user?.id ? user.id : undefined;
    getSendPaymentPublic(id, userId)
      .then(setData)
      .catch((err) => {
        setError(err?.message || 'Link not found');
      })
      .finally(() => setLoading(false));
  }, [id, authenticated, user?.id]);

  const { text: messageText, imageUrl: messageImageUrl } = useMemo(
    () => parseMessageWithMedia(data?.message),
    [data?.message]
  );

  const handleClaim = async () => {
    if (!authenticated || !user?.id || !id) {
      login();
      return;
    }
    setClaiming(true);
    try {
      await claimSendPayment(id, user.id);
      setClaimed(true);
      setData((d) => (d ? { ...d, status: 'CLAIMED' } : null));
      toast({ title: 'Claimed!', description: 'USDC is in your Loofta wallet.' });
    } catch (err: any) {
      toast({
        title: 'Couldn’t claim',
        description: err?.message || 'Log in with the email or Twitter the sender used.',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  const handleReclaim = async () => {
    if (!authenticated || !user?.id || !id) return;
    setReclaiming(true);
    try {
      const result = await reclaimSendPayment(id, user.id);
      setReclaimed(true);
      const wasClaimed = data?.status === 'CLAIMED';
      if (!wasClaimed) {
        setData((d) => (d ? { ...d, status: 'CANCELLED' } : null));
      }
      const amount = result?.amount_reclaimed ?? '';
      toast({
        title: 'Reclaimed',
        description: amount ? `$${amount} USDC returned to your wallet.` : 'Funds returned to your wallet.',
      });
    } catch (err: any) {
      toast({ title: 'Reclaim failed', description: err?.message, variant: 'destructive' });
    } finally {
      setReclaiming(false);
    }
  };

  const openWithdrawModal = () => {
    window.dispatchEvent(new CustomEvent('openBalanceModal'));
  };

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#18181F]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-amber-400" />
              <p className="text-white/80 font-medium">Loading payment…</p>
              <p className="text-base md:text-sm text-white/50">Checking link and amount</p>
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
            <p className="mt-2 text-gray-500">{error || 'This link may be invalid or expired.'}</p>
            <Button variant="outline" className="mt-6 rounded-xl" onClick={() => window.history.back()}>
              Go back
            </Button>
          </div>
        </main>
      </>
    );
  }

  const isClaimed = data.status === 'CLAIMED' || claimed;
  const isCancelled = data.status === 'CANCELLED' || reclaimed;
  const canClaim = !isClaimed && !isCancelled && (data.status === 'OPEN' || data.status === 'FUNDED');
  const isSender = Boolean(data.is_sender);

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
              {/* Amount hero */}
              <div className="text-center">
                <p className="text-5xl font-light tracking-tight text-gray-900 md:text-6xl">
                  ${data.amount}
                </p>
                <p className="mt-1 text-gray-500">{data.token} · {data.chain}</p>

                {(messageText || messageImageUrl) && (
                  <div className="mt-6 border-t border-gray-100 pt-6 space-y-4">
                    {messageText && (
                      <p className="text-gray-600 text-base leading-relaxed">{messageText}</p>
                    )}
                    {messageImageUrl && (
                      <div className="flex justify-center">
                        <div className="relative rounded-2xl overflow-hidden bg-gray-100 max-w-[280px] mx-auto aspect-square">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={messageImageUrl}
                            alt=""
                            className="object-cover w-full h-full"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <p className="mt-4 text-base md:text-sm text-gray-400">
                  Sent to {data.recipient_type === 'email' ? 'an email address' : 'a Twitter account'}
                </p>
              </div>

              {/* Claimed success */}
              {isClaimed && !isSender && (
                <div className="mt-8 space-y-6">
                  <div className="rounded-xl bg-green-50 p-6 text-center">
                    <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
                    <h2 className="mt-3 text-lg font-semibold text-gray-900">You claimed it!</h2>
                    <p className="mt-1 text-base md:text-sm text-gray-600">
                      ${data.amount} {data.token} is in your Loofta wallet. Withdraw to any chain whenever you’re ready.
                    </p>
                  </div>
                  <GradientActionButton
                    onClick={openWithdrawModal}
                    className="h-12 w-full rounded-2xl"
                  >
                    <Wallet className="mr-2 h-5 w-5" />
                    Withdraw to any chain
                  </GradientActionButton>
                  <p className="text-center text-base md:text-sm text-gray-400">
                    Or open Balance in the header anytime to withdraw.
                  </p>
                </div>
              )}

              {/* Claimed — sender: reclaim leftover */}
              {isClaimed && isSender && !reclaimed && (
                <div className="mt-8 space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-6">
                  <p className="text-center font-medium text-gray-900">Recipient already claimed</p>
                  <p className="text-center text-base md:text-sm text-gray-600">
                    You can reclaim any leftover funds that may still be in this link.
                  </p>
                  <Button
                    onClick={handleReclaim}
                    disabled={reclaiming}
                    variant="outline"
                    className="h-12 w-full rounded-2xl border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    {reclaiming ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                    Reclaim leftover
                  </Button>
                </div>
              )}

              {/* Claimed — sender, already reclaimed leftover */}
              {isClaimed && isSender && reclaimed && (
                <div className="mt-8 rounded-xl bg-gray-50 p-6 text-center">
                  <p className="font-medium text-gray-700">Recipient claimed this payment.</p>
                  <p className="mt-1 text-base md:text-sm text-gray-500">Any leftover has been reclaimed to your wallet.</p>
                </div>
              )}

              {/* Cancelled */}
              {isCancelled && (
                <div className="mt-8 rounded-xl bg-gray-50 p-6 text-center">
                  <p className="font-medium text-gray-700">This link is no longer active.</p>
                  <p className="mt-1 text-base md:text-sm text-gray-500">The payment was cancelled or already reclaimed.</p>
                </div>
              )}

              {/* Not logged in — prompt to claim */}
              {canClaim && !authenticated && (
                <div className="mt-8 space-y-6">
                  <p className="text-center text-gray-600">
                    Log in with the <strong>{data.recipient_type === 'email' ? 'email' : 'Twitter'}</strong> the sender used. Only that account can claim this payment.
                  </p>
                  <GradientActionButton onClick={() => login()} className="h-12 w-full rounded-2xl">
                    <LogIn className="mr-2 h-5 w-5" />
                    Log in to claim ${data.amount}
                  </GradientActionButton>
                </div>
              )}

              {/* Logged in, recipient — claim button */}
              {canClaim && authenticated && !isSender && (
                <div className="mt-8 space-y-4">
                  <p className="text-center text-base md:text-sm text-gray-500">
                    Funds will go to your Loofta embedded wallet. You can withdraw to any chain after.
                  </p>
                  <GradientActionButton
                    onClick={handleClaim}
                    disabled={claiming}
                    loading={claiming}
                    loadingText="Claiming…"
                    className="h-12 w-full rounded-2xl"
                  >
                    <CheckCircle2 className="mr-2 h-5 w-5" />
                    Claim ${data.amount} {data.token}
                  </GradientActionButton>
                </div>
              )}

              {/* Sender — reclaim */}
              {canClaim && authenticated && isSender && (
                <div className="mt-8 space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-6">
                  <p className="text-center font-medium text-gray-900">You sent this payment</p>
                  <p className="text-center text-base md:text-sm text-gray-600">If the recipient hasn’t claimed it, you can take the funds back.</p>
                  <Button
                    onClick={handleReclaim}
                    disabled={reclaiming}
                    variant="destructive"
                    className="h-12 w-full rounded-2xl"
                  >
                    {reclaiming ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                    Reclaim funds
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
