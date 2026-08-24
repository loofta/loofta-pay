'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useParams, useRouter, usePathname } from 'next/navigation';
import confetti from 'canvas-confetti';
import { formatDistanceToNowStrict } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { getLotteryGiftPublic, claimLotteryGift, updateGiftRecipient, type LotteryGiftPublic } from '@/services/api/lotteryGift';
import { ShareLinkMenu } from '@/components/ShareLinkMenu';
import { DescriptionWithGif } from '@/components/DescriptionWithGif';
import { TicketNumberCard } from '@/components/megapot/TicketNumberCard';
import { CardShell, Avatar, Chip, Perforation, StepRow, NumberPlaceholderGrid } from './_parts';
import { Loader2, LogIn, CheckCircle2, Ticket, AlertCircle, Clock, Gift, Copy, Pencil, Mail, AtSign, Check, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SITE_URL = 'https://pay.loofta.xyz';
// Numbers poll: 5s cadence, ~2 minutes total — matches this page's own existing "usually just a
// couple of minutes" copy for how long the bridge/mint settlement can take.
const NUMBERS_POLL_INTERVAL_MS = 5_000;
const NUMBERS_POLL_MAX_ATTEMPTS = 24;

function fireConfetti() {
  confetti({
    particleCount: 40,
    spread: 55,
    startVelocity: 28,
    scalar: 0.7,
    origin: { x: 0.5, y: 0.5 },
    colors: ['#FF1301', '#EAB308', '#22c55e'],
  });
}

function formatPrizePool(prizePool: string | null): string | null {
  if (!prizePool) return null;
  const n = parseFloat(prizePool);
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : null;
}

function formatDrawTime(drawTime: string | null): string | null {
  if (!drawTime) return null;
  return new Date(drawTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Gradient-accent headline matching the reference design's two-line treatment — plain first
 *  line, gradient-text second line. */
function Headline({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <h1 className="text-center font-display text-3xl md:text-4xl font-semibold leading-[1.08] tracking-tight text-white">
      {line1}
      <br />
      <span className="bg-gradient-to-r from-[#FF1301] to-[#EAB308] bg-clip-text text-transparent">{line2}</span>
    </h1>
  );
}

export default function LotteryGiftClaimPage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';
  const router = useRouter();
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const { toast } = useToast();

  // Same isAppPath convention as GiftShareClient/HistoryTab — proxy.ts already rewrites clean
  // paths to /app/* on pay.loofta.xyz, so only prefix when we're already under /app.
  const isAppPath = usePathname()?.startsWith('/app');
  const megapotHref = isAppPath ? '/app/megapot?tab=history' : '/megapot?tab=history';
  const buyHref = isAppPath ? '/app/megapot' : '/megapot';
  const shareUrl = `${SITE_URL}/gift/${token}`;
  const [shareCopied, setShareCopied] = useState(false);

  const [data, setData] = useState<LotteryGiftPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimedTicketId, setClaimedTicketId] = useState<string | null>(null);
  const [ticketNumbers, setTicketNumbers] = useState<{ main: number[]; bonus: number }[] | null>(null);
  // True once a poll round has used up NUMBERS_POLL_MAX_ATTEMPTS without the numbers landing —
  // without this the page just sits on the loading card forever with no way out.
  const [pollExhausted, setPollExhausted] = useState(false);
  const numbersPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const numbersConfettiFiredRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRecipient, setEditingRecipient] = useState(false);
  const [editRecipientValue, setEditRecipientValue] = useState('');
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [editRecipientError, setEditRecipientError] = useState<string | null>(null);
  // Jackpot/next-draw is only meaningful once the viewer is definitely in a "claimed" state (see
  // plan decision — no public endpoint, this reuses the existing authenticated dashboard route).
  const [nextDraw, setNextDraw] = useState<{ prizePool: string | null; drawTime: string | null } | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Invalid link');
      return;
    }
    // Re-fetches when auth state changes so isSender/isClaimant/isRecipient reflect who's
    // actually logged in — e.g. a visitor who logs in after the initial anonymous load. Reset to
    // loading (not just leave stale anonymous data sitting there) since the backend 404s a
    // logged-in viewer who turns out to be none of sender/claimant/recipient — without this reset
    // that verification-in-flight window would flash the old anonymous state instead.
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const accessToken = authenticated ? await getAccessToken() : null;
        const gift = await getLotteryGiftPublic(token, accessToken);
        setData(gift);
      } catch (err: any) {
        setData(null);
        setError(err?.message || 'Link not found');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, authenticated, getAccessToken]);

  const stopNumbersPoll = () => {
    if (numbersPollRef.current) {
      clearInterval(numbersPollRef.current);
      numbersPollRef.current = null;
    }
  };
  useEffect(() => () => stopNumbersPoll(), []);

  useEffect(() => {
    if (ticketNumbers && ticketNumbers.length > 0 && !numbersConfettiFiredRef.current) {
      numbersConfettiFiredRef.current = true;
      fireConfetti();
    }
  }, [ticketNumbers]);

  // Fetch once when a claimed state first renders (recipient with numbers in, or sender whose
  // gift was claimed) — never on the pre-claim card, per the "show it after claim" decision.
  const isClaimedForDraw = data?.status === 'claimed' || Boolean(claimedTicketId);
  useEffect(() => {
    if (!isClaimedForDraw || nextDraw || !authenticated) return;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const res = await fetch('/api/lottery/dashboard', {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });
        if (!res.ok) return;
        const dashboard = await res.json();
        if (dashboard?.nextDraw) setNextDraw({ prizePool: dashboard.nextDraw.prizePool ?? null, drawTime: dashboard.nextDraw.drawTime ?? null });
      } catch { /* non-fatal — the row just doesn't render without it */ }
    })();
  }, [isClaimedForDraw, nextDraw, authenticated, getAccessToken]);

  /** One status fetch — used both for the initial post-claim check and every poll tick. Returns
   *  the numbers array (possibly empty) so the caller can decide whether to keep polling. */
  const checkTicketNumbers = async (ticketId: string, accessToken: string | null): Promise<{ main: number[]; bonus: number }[]> => {
    try {
      const res = await fetch(`/api/lottery/status/${ticketId}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) return [];
      const status = await res.json();
      return Array.isArray(status?.ticketNumbers) ? status.ticketNumbers : [];
    } catch {
      return [];
    }
  };

  /** Numbers resolve asynchronously (bridge/mint settlement) — not literally the instant claim
   *  succeeds, but auto-revealed the moment they're ready rather than requiring a manual refresh.
   *  Fires sync-numbers once up front (forces Loofta to check Megapot now, instead of waiting for
   *  the ticket to naturally pick up numbers on its own schedule), then polls status until the
   *  numbers show up or NUMBERS_POLL_MAX_ATTEMPTS is hit. */
  const pollForTicketNumbers = async (ticketId: string, accessToken: string | null) => {
    setPollExhausted(false);
    try {
      await fetch(`/api/lottery/tickets/${ticketId}/sync-numbers`, {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
    } catch { /* non-fatal — the poll below will still pick numbers up once they land naturally */ }

    let attempts = 0;
    stopNumbersPoll();
    numbersPollRef.current = setInterval(async () => {
      attempts += 1;
      const numbers = await checkTicketNumbers(ticketId, accessToken);
      if (numbers.length > 0) {
        setTicketNumbers(numbers);
        stopNumbersPoll();
        return;
      }
      if (attempts >= NUMBERS_POLL_MAX_ATTEMPTS) {
        stopNumbersPoll();
        setPollExhausted(true);
      }
    }, NUMBERS_POLL_INTERVAL_MS);
  };

  /** Ticket id to poll against — the just-claimed response value if this session did the
   *  claiming, otherwise whatever getGiftPublic returned (resultingTicketId), which is what
   *  makes resuming after a page reload possible at all. */
  const activeTicketId = claimedTicketId ?? data?.resultingTicketId ?? null;

  /** Shared by the initial claim and the reload-resume effect below — one immediate check, then
   *  fall back to polling if numbers aren't in yet. */
  const startOrResumeNumbersFlow = async (ticketId: string, accessToken: string | null) => {
    const numbers = await checkTicketNumbers(ticketId, accessToken);
    if (numbers.length > 0) {
      setTicketNumbers(numbers);
    } else {
      pollForTicketNumbers(ticketId, accessToken);
    }
  };

  /** Manual retry after a round gives up — same sync+poll sequence, just re-armed by hand
   *  instead of the "check back in a moment" text being a dead end. */
  const retryNumbersPoll = async () => {
    if (!activeTicketId) return;
    const accessToken = await getAccessToken();
    pollForTicketNumbers(activeTicketId, accessToken);
  };

  // Resumes the numbers flow after a page reload (or opening the claim link again later) while
  // numbers are still pending — without this, a claimant who reloads mid-wait has no poll running
  // and no way to start one, since handleClaim (the only other trigger) never runs again once
  // already claimed. Guards on numbersPollRef so this doesn't fight an already-running poll.
  useEffect(() => {
    if (!data?.isClaimant || data.status !== 'claimed') return;
    if (ticketNumbers || claimedTicketId || numbersPollRef.current) return;
    if (!data.resultingTicketId) return;
    (async () => {
      const accessToken = await getAccessToken();
      startOrResumeNumbersFlow(data.resultingTicketId!, accessToken);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.isClaimant, data?.status, data?.resultingTicketId]);

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
      setData((d) => (d ? { ...d, status: 'claimed', isClaimant: true } : null));
      toast({ title: 'Claimed!', description: `${result.numTickets} Megapot ticket${result.numTickets === 1 ? '' : 's'} on the way.` });

      // One immediate check — then, if numbers aren't in yet, keep polling for them in the
      // background (see pollForTicketNumbers).
      await startOrResumeNumbersFlow(result.ticketId, accessToken);
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

  const startEditRecipient = () => {
    setEditRecipientValue(data?.recipientIdentifier ?? '');
    setEditRecipientError(null);
    setEditingRecipient(true);
  };

  const saveEditRecipient = async () => {
    if (!data?.giftId) return;
    const trimmed = editRecipientValue.trim();
    if (!trimmed) { setEditRecipientError('Required'); return; }
    const recipientType = trimmed.includes('@') && trimmed.includes('.') ? 'email' : 'handle';
    const identifier = trimmed.replace(/^@+/, '');
    setSavingRecipient(true);
    setEditRecipientError(null);
    try {
      const accessToken = await getAccessToken();
      await updateGiftRecipient(data.giftId, recipientType, identifier, user!.id, accessToken);
      setData((d) => (d ? { ...d, recipientType, recipientIdentifier: identifier } : null));
      setEditingRecipient(false);
      toast({ title: 'Recipient updated' });
    } catch (err: any) {
      setEditRecipientError(err?.message || "Couldn't save — try again.");
    } finally {
      setSavingRecipient(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center px-4 py-8 md:py-12">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 space-y-5 animate-pulse">
              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-white/[0.08]" />
                <div className="h-8 w-40 rounded-lg bg-white/[0.08]" />
                <div className="h-4 w-52 rounded-lg bg-white/[0.06]" />
              </div>
              <div className="h-12 w-full rounded-xl bg-white/[0.06]" />
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
            <h1 className="text-xl font-semibold text-white">{error ? 'Not available' : 'Something went wrong'}</h1>
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

  // Identity is fully verified server-side before data ever gets here: getGiftPublic computes
  // isSender/isClaimant/isRecipient from the viewer's linked email/X/username and 404s (same as a
  // bad token) for anyone logged in who matches none of them — so by the time we have `data` for
  // an authenticated viewer, they're guaranteed to be the sender, the claimant, or the genuine
  // (not-yet-claimed) recipient. Anonymous visitors still need to log in first, below.
  if (!authenticated) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF7A2A]/15">
              <Gift className="h-7 w-7 text-[#FF7A2A]" />
            </div>
            <h1 className="text-xl font-semibold text-white">Sign in to view this gift</h1>
            <p className="mt-2 text-slate-400">Only the sender and the intended recipient can see this page.</p>
            <button
              onClick={() => login()}
              className="mt-6 w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Log in to continue
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
  // A sender who also happens to match the recipient identity (self-gifting to test) is both —
  // treat that combo as "claimant" copy, since they really did claim it themselves.
  const viewerIsSenderOnly = data.isSender && !data.isClaimant;
  const recipientLabel = data.recipientIdentifier
    ? (data.recipientType === 'handle' ? `@${data.recipientIdentifier}` : data.recipientIdentifier)
    : 'them';
  const senderLabel = data.senderHandle ? `@${data.senderHandle}` : data.senderUsername ? `@${data.senderUsername}` : 'Someone';
  const sentAgo = data.createdAt ? formatDistanceToNowStrict(new Date(data.createdAt), { addSuffix: true }) : 'just now';
  const claimedAgo = data.claimedAt ? formatDistanceToNowStrict(new Date(data.claimedAt), { addSuffix: true }) : 'just now';
  const prizePoolLabel = formatPrizePool(nextDraw?.prizePool ?? null);
  const drawTimeLabel = formatDrawTime(nextDraw?.drawTime ?? null);

  const DrawRow = prizePoolLabel || drawTimeLabel ? (
    <div className="flex items-center justify-between gap-4 px-5 pt-4">
      {drawTimeLabel && (
        <div>
          <div className="text-base font-semibold uppercase tracking-[0.18em] text-slate-500">Next draw</div>
          <div className="mt-1 font-display text-base font-medium text-white">{drawTimeLabel}</div>
        </div>
      )}
      {prizePoolLabel && (
        <div className="text-right">
          <div className="text-base font-semibold uppercase tracking-[0.18em] text-slate-500">Jackpot</div>
          <div className="mt-1 bg-gradient-to-r from-[#FF1301] to-[#EAB308] bg-clip-text font-display text-xl font-semibold text-transparent">{prizePoolLabel}</div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#0f0f12]" />
      <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center px-4 py-8 md:py-12">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${data.status}-${viewerIsSenderOnly}-${Boolean(ticketNumbers)}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* ── Recipient, pre-claim ─────────────────────────────────────── */}
              {canClaim && !viewerIsSenderOnly && (
                <>
                  <Headline line1={`${senderLabel} sent you`} line2={`${data.numTickets} Megapot ${ticketWord}.`} />
                  <p className="text-center text-base leading-relaxed text-slate-400">
                    {senderLabel} already paid — claiming buys it on-chain for the next draw.
                  </p>
                  <CardShell>
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                      <Avatar label={senderLabel} avatarUrl={data.senderAvatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-medium text-white">{senderLabel}</div>
                        <div className="text-base text-slate-500">Sent {sentAgo}</div>
                      </div>
                      <Chip>Gift · Free for you</Chip>
                    </div>
                    {data.note && (
                      <div className="px-5 pb-4">
                        <DescriptionWithGif text={data.note} />
                      </div>
                    )}
                    <div className="border-t border-white/[0.09] px-5 py-5">
                      <NumberPlaceholderGrid />
                    </div>
                    <Perforation />
                    <div className="px-5 py-4 text-center text-base text-slate-500">Numbers are drawn when you claim</div>
                  </CardShell>
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-[0_16px_34px_-16px_rgba(255,19,1,0.7)] hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {claiming ? <><Loader2 className="w-5 h-5 animate-spin" /> Claiming…</> : 'Claim my ticket'}
                  </button>
                  <p className="text-center text-base leading-relaxed text-slate-500">
                    Nothing to pay and no wallet needed. {senderLabel} can see that you claimed, never your numbers.
                  </p>
                </>
              )}

              {/* ── Recipient, claimed, numbers still resolving ─────────────────── */}
              {isClaimed && !viewerIsSenderOnly && !ticketNumbers && (
                <>
                  <Headline line1="Buying your" line2="ticket on-chain." />
                  <p className="text-center text-base leading-relaxed text-slate-400">
                    {pollExhausted
                      ? "Taking longer than usual — your ticket is safe, we just haven't heard back yet."
                      : "Usually just a couple of minutes. You can leave this page — we'll finish it."}
                  </p>
                  <CardShell>
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                      <Avatar label={senderLabel} avatarUrl={data.senderAvatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-medium text-white">{senderLabel}</div>
                        <div className="text-base text-slate-500">Gift claimed · {claimedAgo}</div>
                      </div>
                      <Chip tone="wait">In progress</Chip>
                    </div>
                    <div className="grid gap-4 border-t border-white/[0.09] px-5 py-5">
                      <StepRow state="done" title="Gift accepted" sub="You're the verified recipient" />
                      <StepRow state={pollExhausted ? 'todo' : 'now'} title="Minting your ticket" sub={pollExhausted ? 'Still waiting on the network' : 'Usually just a couple of minutes'} />
                      <StepRow state="todo" title="Assigning your numbers" sub="Drawn at mint, private to you" />
                    </div>
                    <Perforation />
                    <div className="px-5 py-5">
                      <NumberPlaceholderGrid shimmer={!pollExhausted} />
                    </div>
                  </CardShell>
                  {pollExhausted ? (
                    <button
                      onClick={retryNumbersPoll}
                      className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-[0_16px_34px_-16px_rgba(255,19,1,0.7)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                    >
                      Check again
                    </button>
                  ) : (
                    <button disabled className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white opacity-50 cursor-default flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" /> Finishing up…
                    </button>
                  )}
                  <p className="text-center text-base leading-relaxed text-slate-500">
                    Your ticket is safe the moment the gift is accepted, even if you close the app.
                  </p>
                </>
              )}

              {/* ── Recipient, claimed, numbers ready ────────────────────────────── */}
              {isClaimed && !viewerIsSenderOnly && ticketNumbers && (
                <>
                  <Headline line1="You're in the" line2="next draw." />
                  <p className="text-center text-base leading-relaxed text-slate-400">
                    {senderLabel} gifted you {data.numTickets} {ticketWord} and covered the cost.
                  </p>
                  <CardShell>
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                      <Avatar label={senderLabel} avatarUrl={data.senderAvatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-medium text-white">{senderLabel}</div>
                        <div className="text-base text-slate-500">Gift claimed · {claimedAgo}</div>
                      </div>
                      <Chip tone="ok"><Check className="h-3 w-3" strokeWidth={3} />On-chain</Chip>
                    </div>
                    {data.note && (
                      <div className="px-5 pb-4">
                        <DescriptionWithGif text={data.note} />
                      </div>
                    )}
                    {DrawRow}
                    <div className="space-y-2 px-5 py-5">
                      {ticketNumbers.map((tn, i) => (
                        <TicketNumberCard key={i} tn={tn} />
                      ))}
                    </div>
                    <Perforation />
                    <div className="px-5 py-4 text-center text-base text-slate-500">
                      Gifted by <span className="font-medium text-white">{senderLabel}</span>
                    </div>
                  </CardShell>
                  <div className="grid gap-2.5">
                    <button
                      onClick={() => router.push(megapotHref)}
                      className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-[0_16px_34px_-16px_rgba(255,19,1,0.7)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                    >
                      <Ticket className="w-5 h-5" /> Go to tickets
                    </button>
                    <button
                      onClick={() => {
                        const tweetText = `Thanks for the Megapot ticket, ${senderLabel}! 🎟️`;
                        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, '_blank', 'noopener,noreferrer');
                      }}
                      className="w-full h-14 rounded-2xl border border-white/10 bg-transparent font-display text-[16.5px] font-semibold text-white transition-all hover:bg-white/[0.06] flex items-center justify-center gap-2"
                    >
                      <Share2 className="w-4 h-4" /> Thank {senderLabel}
                    </button>
                  </div>
                  <p className="text-center text-base leading-relaxed text-slate-500">
                    Numbers stay private to you. If you win, the payout comes straight to your balance.
                  </p>
                </>
              )}

              {/* ── Sender, still unclaimed ──────────────────────────────────────── */}
              {canClaim && viewerIsSenderOnly && (
                <>
                  <Headline line1="You gifted" line2={`${data.numTickets} Megapot ${ticketWord}.`} />
                  <p className="text-center text-base leading-relaxed text-slate-400">
                    {recipientLabel} hasn&apos;t claimed it yet.
                  </p>
                  <CardShell>
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                      <Avatar label={recipientLabel} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-medium text-white">{recipientLabel}</div>
                        <div className="text-base text-slate-500">Sent {sentAgo}</div>
                      </div>
                      <Chip tone="wait">Unclaimed</Chip>
                    </div>
                    {data.note && (
                      <div className="px-5 pb-4">
                        <DescriptionWithGif text={data.note} />
                      </div>
                    )}
                    <div className="border-t border-white/[0.09] px-5 py-5 space-y-4">
                      <div className="flex gap-2">
                        <div className="h-12 flex-1 min-w-0 flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4">
                          <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                            className="flex-1 min-w-0 truncate text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors">
                            {shareUrl}
                          </a>
                          <button
                            onClick={() => { navigator.clipboard.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 1500); }}
                            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                            aria-label="Copy share link"
                          >
                            {shareCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <ShareLinkMenu
                          url={shareUrl}
                          title="Megapot ticket gift"
                          text={`I gifted ${data.numTickets} Megapot ${ticketWord} on Loofta 🎟️`}
                          ogUrl={`${SITE_URL}/api/gift/${token}/og`}
                          triggerClassName="h-12"
                        />
                      </div>

                      {editingRecipient ? (
                        <div className="space-y-2">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                              {editRecipientValue.includes('@') && editRecipientValue.includes('.') ? <Mail className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
                            </span>
                            <input
                              value={editRecipientValue}
                              onChange={e => setEditRecipientValue(e.target.value.replace(/^@+/, ''))}
                              placeholder="Email, X handle, or Loofta username"
                              className="w-full bg-white/[0.03] border border-white/10 text-slate-100 placeholder:text-slate-600 rounded-lg pl-10 pr-3 py-2 text-base"
                            />
                          </div>
                          {editRecipientError && <p className="text-sm text-red-400">{editRecipientError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={saveEditRecipient}
                              disabled={savingRecipient}
                              className="flex-1 h-11 rounded-xl font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40"
                            >
                              {savingRecipient ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingRecipient(false)}
                              disabled={savingRecipient}
                              className="flex-1 h-11 rounded-xl font-semibold text-base border border-white/10 text-slate-200 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={startEditRecipient}
                          className="w-full h-12 rounded-xl font-semibold text-lg border border-white/10 text-slate-200 hover:bg-white/[0.06] transition-all flex items-center justify-center gap-2"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit recipient
                        </button>
                      )}
                    </div>
                  </CardShell>
                  <p className="text-center text-base leading-relaxed text-slate-500">
                    Numbers stay private to {recipientLabel}. If they win, the payout goes to them.
                  </p>
                </>
              )}

              {/* ── Sender, claimed ───────────────────────────────────────────────── */}
              {isClaimed && viewerIsSenderOnly && (
                <>
                  <Headline line1="Your gift was" line2="claimed." />
                  <p className="text-center text-base leading-relaxed text-slate-400">
                    {recipientLabel} has their {ticketWord} and {data.numTickets === 1 ? 'is' : 'are'} entered in the next draw.
                  </p>
                  <CardShell>
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                      <Avatar label={recipientLabel} avatarUrl={data.recipientAvatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-medium text-white">{recipientLabel}</div>
                        <div className="text-base text-slate-500">Claimed {claimedAgo}</div>
                      </div>
                      <Chip tone="ok"><Check className="h-3 w-3" strokeWidth={3} />Claimed</Chip>
                    </div>
                    {data.note && (
                      <div className="px-5 pb-4">
                        <DescriptionWithGif text={data.note} />
                      </div>
                    )}
                    {DrawRow}
                    <Perforation />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-5">
                      <div>
                        <div className="text-base font-semibold uppercase tracking-[0.18em] text-slate-500">Gift</div>
                        <div className="mt-1 font-display text-base font-medium text-white">{data.numTickets} Megapot {ticketWord}</div>
                      </div>
                      <div>
                        <div className="text-base font-semibold uppercase tracking-[0.18em] text-slate-500">You paid</div>
                        <div className="mt-1 font-display text-base font-medium text-white">${data.costUsdc.toFixed(2)}</div>
                      </div>
                    </div>
                  </CardShell>
                  <div className="grid gap-2.5">
                    <button
                      onClick={() => router.push(buyHref)}
                      className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white shadow-[0_16px_34px_-16px_rgba(255,19,1,0.7)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                    >
                      <Gift className="w-5 h-5" /> Send another ticket
                    </button>
                    <button
                      onClick={() => router.push(megapotHref)}
                      className="w-full h-14 rounded-2xl font-display font-semibold text-[16.5px] border border-white/10 text-white hover:bg-white/[0.06] transition-all flex items-center justify-center gap-2"
                    >
                      View your sent gifts
                    </button>
                  </div>
                  <p className="text-center text-base leading-relaxed text-slate-500">
                    Numbers stayed private to {recipientLabel} the whole time — if they win, the payout goes to them.
                  </p>
                </>
              )}

              {/* ── Pending / unavailable — unchanged, rare states ───────────────── */}
              {isUnavailable && (
                <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-8 text-center">
                  <p className="font-medium text-slate-300">This gift is no longer available.</p>
                </div>
              )}
              {isPending && (
                <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-8 text-center flex flex-col items-center gap-2">
                  <Clock className="h-6 w-6 text-amber-400" />
                  <p className="font-medium text-slate-300">This gift is still being set up.</p>
                  <p className="text-sm text-slate-500">Check back in a moment.</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
