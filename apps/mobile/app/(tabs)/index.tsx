import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Shuffle, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../../components/AuthGate';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GhostButton } from '../../components/ui/GhostButton';
import { Card } from '../../components/ui/Card';
import { CountdownTile } from '../../components/ui/CountdownTile';
import { GradientText } from '../../components/ui/GradientText';
import { buyTickets, cancelTicket, confirmBuy, getDashboard, getTicketStatus, type TicketStatus } from '../../lib/api/lottery';
import { fmt, mbFee, totalCost, TICKET_PRICE_USDC } from '../../lib/lottery/fees';
import { connectSeekerWallet, signAndSendTransactionWithSeeker } from '../../lib/wallet/mwa';
import { useBalances } from '../../lib/wallet/BalanceProvider';
import { updateCachedSkrDomain } from '../../lib/storage/seekerIdentity';
import { useTranslation } from '../../lib/i18n/LanguageProvider';
import { color, radius, space } from '../../lib/theme';
import { FONT_TITLE, FONT_TITLE_SEMIBOLD, FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from '../../lib/fonts';

const PRESETS = [5, 10, 50, 100];
const MIN_TICKETS = 1;
const MAX_TICKETS = 100;

// ── Prize pool + countdown ──────────────────────────────────────────────────
// Ported from apps/frontend/src/app/app/megapot/page.tsx's PrizePoolHero — same field names
// (nextDraw.prizePool / nextDraw.drawTime from the dashboard), same digit-box styling via
// CountdownTile, and the same top-to-bottom white → amber gradient on the amount (web's
// `bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text`).
function PrizePoolHero({ prizePool, drawTime }: { prizePool: string | null; drawTime: string | null }) {
  const { t, localeTag } = useTranslation();
  const [cd, setCd] = useState({ h: 0, m: 0, s: 0, done: true });

  useEffect(() => {
    if (!drawTime) {
      setCd({ h: 0, m: 0, s: 0, done: true });
      return;
    }
    const target = new Date(drawTime).getTime();
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setCd({ h: 0, m: 0, s: 0, done: true });
        return;
      }
      setCd({
        h: Math.floor(diff / 3_600_000),
        m: Math.floor((diff % 3_600_000) / 60_000),
        s: Math.floor((diff % 60_000) / 1000),
        done: false,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawTime]);

  const amount = prizePool ? Math.round(parseFloat(prizePool) / 100_000) * 100_000 : 1_100_000;
  const pad = (n: number) => String(n).padStart(2, '0');
  const segs = [
    { v: pad(cd.h), l: t.hrs },
    { v: pad(cd.m), l: t.min },
    { v: pad(cd.s), l: t.sec },
  ];

  return (
    <View style={styles.prizePool}>
      <Text style={styles.prizePoolLabel}>{t.prizePool}</Text>
      <GradientText
        style={styles.prizePoolAmount}
        colors={['#FFFFFF', '#F1F5F9', '#FDE68A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        {`$${amount.toLocaleString(localeTag)}`}
      </GradientText>
      <View style={styles.countdownRow}>
        {segs.map((seg, i) => (
          <CountdownTile key={seg.l} value={seg.v} label={seg.l} showColon={i > 0} />
        ))}
      </View>
    </View>
  );
}

// ── Ticket numbers (cosmetic — mirrors apps/frontend/src/app/app/megapot/page.tsx's "Choose
// numbers" feature exactly: one TicketNumbers per ticket, a collapsible row-list, "Shuffle all",
// tap a row to edit it in the full-screen picker, "Add ticket". Not sent to the backend — Megapot
// assigns real ball numbers at mint time, fetched back and shown after purchase. ──
interface TicketNumbers {
  main: number[];
  bonus: number;
}
const MAIN_MAX = 30;
const MAIN_COUNT = 5;
const BONUS_MAX = 12;
const NUMBER_PICKER_LIMIT = 10;

function randomTicket(): TicketNumbers {
  const s = new Set<number>();
  while (s.size < MAIN_COUNT) s.add(Math.ceil(Math.random() * MAIN_MAX));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * BONUS_MAX) };
}

// ── Post-purchase success screen pieces — ported from apps/frontend's DrawSuccessModal ─────

/** Same "DRAW IN" countdown as DrawSuccessModal — separate from PrizePoolHero's countdown since
 *  this one hides itself once the draw time passes instead of freezing at 00:00:00. */
function DrawInCountdown({ drawTime }: { drawTime: string | null }) {
  const { t, localeTag } = useTranslation();
  const [msLeft, setMsLeft] = useState(() => (drawTime ? new Date(drawTime).getTime() - Date.now() : 0));

  useEffect(() => {
    if (!drawTime) return;
    const tick = () => setMsLeft(new Date(drawTime).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawTime]);

  if (!drawTime || msLeft <= 0) return null;

  const totalSecs = Math.floor(msLeft / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const segs = [
    { v: pad(Math.floor(totalSecs / 3600)), l: t.hrs },
    { v: pad(Math.floor((totalSecs % 3600) / 60)), l: t.min },
    { v: pad(totalSecs % 60), l: t.sec },
  ];
  const drawLocal = new Date(drawTime).toLocaleString(localeTag, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={{ gap: space[2] }}>
      <Text style={styles.drawInLabel}>{t.drawIn}</Text>
      <View style={styles.countdownRow}>
        {segs.map((seg, i) => (
          <CountdownTile key={seg.l} value={seg.v} label={seg.l} showColon={i > 0} />
        ))}
      </View>
      <Text style={styles.drawLocalText}>{t.drawDateLabel(drawLocal)}</Text>
    </View>
  );
}

/** Same "no win data yet" rendering as web's TicketNumberCard when used without a winningNumbers
 *  prop — plain numbers (not bubbles), only the bonus gets the amber circle treatment. */
function TicketNumberCard({ tn }: { tn: TicketNumbers }) {
  const { t } = useTranslation();
  return (
    <View style={styles.numberCard}>
      <View style={styles.numberCardMain}>
        <Text style={styles.numberCardLabel}>{t.ticketCardNumbersLabel}</Text>
        <View style={styles.numberCardMainRow}>
          {tn.main.map((n) => (
            <Text key={n} style={styles.numberCardDigit}>{n}</Text>
          ))}
        </View>
      </View>
      <View style={styles.numberCardDivider} />
      <View style={styles.numberCardBonusCol}>
        <Text style={styles.numberCardLabel}>{t.ticketCardBonusLabel}</Text>
        <View style={styles.numberCardBonusCircle}>
          <Text style={styles.numberCardBonusText}>{tn.bonus}</Text>
        </View>
      </View>
    </View>
  );
}

type BuyStep = 'idle' | 'signing' | 'sent' | 'bridging' | 'buying' | 'done' | 'error';

const STATUS_TO_STEP: Partial<Record<TicketStatus, BuyStep>> = {
  sent: 'sent',
  bridging: 'bridging',
  buying: 'buying',
  active: 'done',
  won: 'done',
  failed: 'error',
};

const CONFETTI_COLORS = ['#FF7A2A', '#FDBA74', '#34d399', '#22d3ee', '#7c3aed', '#ec4899', '#eab308', '#3b82f6'];

interface ConfettiPiece { id: number; x: number; color: string; delay: number; spin: number; anim: Animated.Value; }

function ConfettiBurst() {
  const pieces = useRef<ConfettiPiece[]>(
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: 4 + Math.random() * 92,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 250,
      spin: Math.random() * 360,
      anim: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    Animated.stagger(
      12,
      pieces.map((p) =>
        Animated.timing(p.anim, { toValue: 1, duration: 1100 + Math.random() * 500, delay: p.delay, useNativeDriver: true }),
      ),
    ).start();
  }, [pieces]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 440] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
        const rotate = p.anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin + 360}deg`] });
        return (
          <Animated.View
            key={p.id}
            style={[
              styles.confettiPiece,
              { left: `${p.x}%`, backgroundColor: p.color, opacity, transform: [{ translateY }, { rotate }] },
            ]}
          />
        );
      })}
    </View>
  );
}

function CelebrationScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.celebrationScreen}>
      <ConfettiBurst />
      <Text style={styles.celebrationEmoji}>🎉</Text>
      <Text style={styles.celebrationTitle}>{t.ticketsSecured}</Text>
      <Text style={styles.celebrationSubtitle}>{t.lockingInNumbers}</Text>
    </View>
  );
}

function BuyScreenInner() {
  const { getAccessToken } = usePrivy();
  const router = useRouter();
  const { refreshBalances } = useBalances();
  const { t, localeTag } = useTranslation();
  const stepLabel: Partial<Record<BuyStep, string>> = {
    signing: t.stepConfirmWallet,
    sent: t.stepPaymentSent,
    bridging: t.stepBridging,
    buying: t.stepBuying,
  };

  const [numTickets, setNumTicketsRaw] = useState(5);
  const [tickets, setTickets] = useState<TicketNumbers[]>(() => Array.from({ length: 5 }, randomTicket));
  const [chooseOpen, setChooseOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAllTickets, setShowAllTickets] = useState(false);

  const setTicketCount = (n: number) => {
    const c = Math.max(MIN_TICKETS, Math.min(MAX_TICKETS, n));
    setNumTicketsRaw(c);
    setTickets((prev) => {
      if (prev.length === c) return prev;
      if (c > prev.length) return [...prev, ...Array.from({ length: c - prev.length }, randomTicket)];
      return prev.slice(0, c);
    });
  };
  const updateTicket = (idx: number, t: TicketNumbers) => setTickets((prev) => prev.map((tt, i) => (i === idx ? t : tt)));

  const [step, setStep] = useState<BuyStep>('idle');
  const [stepError, setStepError] = useState('');
  const isRunning = !['idle', 'done', 'error'].includes(step);

  // A brief confetti beat the instant a purchase lands — gives tappers a clear "stop, it's done"
  // moment before the screen swaps to the Good luck card, instead of the game cutting out mid-tap.
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (step !== 'done') {
      setCelebrating(false);
      return;
    }
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 1600);
    return () => clearTimeout(t);
  }, [step]);

  // Which ticket a poll/AppState-triggered check should look at — a ref (not state) since it's
  // read from a setInterval callback and an AppState listener, neither of which should re-subscribe
  // every time the in-flight ticket changes.
  const activeTicketIdRef = useRef<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => () => stopPoll(), [stopPoll]);

  const checkStatusOnce = useCallback(
    async (ticketId: string) => {
      try {
        const accessToken = await getAccessToken();
        const t = await getTicketStatus(ticketId, accessToken);
        if (!t) return;
        const next = STATUS_TO_STEP[t.status];
        if (next === 'done' || next === 'error') {
          stopPoll();
          activeTicketIdRef.current = null;
          // Covers the resumed-purchase path (app was killed/backgrounded mid-buy and this poll
          // picks it up on relaunch) — the immediate refresh below the signed transaction only
          // fires on the live handleBuy() path, not this one.
          if (next === 'done') void refreshBalances();
        }
        if (next) setStep(next);
      } catch {
        // transient — next tick / next foreground will retry
      }
    },
    [getAccessToken, stopPoll, refreshBalances],
  );

  const pollStatus = useCallback(
    (ticketId: string) => {
      activeTicketIdRef.current = ticketId;
      stopPoll();
      pollRef.current = setInterval(() => checkStatusOnce(ticketId), 5_000);
    },
    [stopPoll, checkStatusOnce],
  );

  // The Seed Vault signing prompt backgrounds the app — JS timers are commonly throttled or
  // paused while backgrounded, so the 5s poll above can silently die mid-purchase even though the
  // backend keeps processing normally. Re-checking immediately on every foreground transition
  // closes that gap without waiting for the next (possibly-never-arriving) interval tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && activeTicketIdRef.current) {
        checkStatusOnce(activeTicketIdRef.current);
      }
    });
    return () => sub.remove();
  }, [checkStatusOnce]);

  const [nextDraw, setNextDraw] = useState<{ prizePool: string | null; drawTime: string | null }>({
    prizePool: null,
    drawTime: null,
  });
  useEffect(() => {
    // Mount-once: fetches the prize pool/countdown, and separately resumes any purchase left
    // in-flight from a prior session (app killed/backgrounded, or this screen simply remounted)
    // — mirrors the web app's dashboard-based restore. Without this, losing the local `step`/poll
    // for any reason leaves the buyer stuck on "Hang tight" forever with no local memory of the
    // ticket, even though the backend is still processing (or already finished) it.
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const dashboard = await getDashboard(accessToken);
        setNextDraw({ prizePool: dashboard.nextDraw?.prizePool ?? null, drawTime: dashboard.nextDraw?.drawTime ?? null });

        const resumable = dashboard.activeTickets.find((t) => ['sent', 'bridging', 'buying'].includes(t.status));
        if (resumable && activeTicketIdRef.current == null) {
          const next = STATUS_TO_STEP[resumable.status];
          if (next) setStep(next);
          pollStatus(resumable.id);
        }
      } catch {
        // keep defaults — PrizePoolHero falls back to a static amount, hides the countdown
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  // Cosmetic phrase rotation, only while a purchase is in flight.
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % t.stealthPhrases.length), 3_500);
    return () => clearInterval(id);
  }, [isRunning, t]);

  // If a purchase sits in the same step for 90s+, it's very likely still fine server-side (cron
  // ticks every 5s in the happy path) — but the buyer deserves an escape hatch rather than an
  // indefinite unlabeled spinner. History now shows in-flight tickets too (see history.tsx), so
  // it's a real answer, not a dead end.
  const [stuckHint, setStuckHint] = useState(false);
  useEffect(() => {
    if (!isRunning) {
      setStuckHint(false);
      return;
    }
    const t = setTimeout(() => setStuckHint(true), 90_000);
    return () => clearTimeout(t);
  }, [isRunning, step]);

  const cost = totalCost(numTickets);

  const resetBuy = () => {
    setStep('idle');
    setStepError('');
  };

  async function handleBuy() {
    setStep('signing');
    setStepError('');
    // Tracked outside the try so the catch block can decide what's actually safe to do: cancel a
    // ticket ONLY if we're certain no signature was ever requested for it. Once
    // signAndSendTransactionWithSeeker has been called, a thrown error (including a
    // CancellationException from the Android/MWA side) does NOT mean the transfer failed — MWA
    // can report cancellation even after the wallet already signed and broadcast successfully.
    // Auto-cancelling in that case would mark a real, funded purchase as failed and delete it
    // while the money has already left the wallet. So past that point, the only safe thing to do
    // is fall back to polling — the backend's on-chain balance check is the actual ground truth.
    let createdTicketId: string | null = null;
    let signAttempted = false;
    let accessToken: string | null = null;
    try {
      const { base58Address, label } = await connectSeekerWallet();
      void updateCachedSkrDomain(label);
      accessToken = await getAccessToken();

      // Only the MagicBlock private transfer to sign now — no separate Loofta fee tx.
      const { ticketId, txBase64 } = await buyTickets(numTickets, base58Address, accessToken);
      createdTicketId = ticketId;
      signAttempted = true;
      const signature = await signAndSendTransactionWithSeeker(txBase64);
      setStep('sent');
      // The transfer has already landed on-chain at this point — refresh now instead of waiting
      // for the header chip's next mount, so the balance doesn't sit stale through the rest of
      // the purchase flow (bridging/buying can take a while).
      void refreshBalances();
      await confirmBuy(ticketId, signature, accessToken);
      pollStatus(ticketId);
    } catch (e: any) {
      setStep('error');
      setStepError(e?.message ?? t.unknownError);
      if (createdTicketId && !signAttempted) {
        // Never reached the wallet prompt at all (e.g. ticket creation itself failed) — no
        // signature could possibly exist, safe to cancel outright.
        cancelTicket(createdTicketId, accessToken)
          .then(() => cancelTicket(createdTicketId!, accessToken))
          .catch(() => { });
      } else if (createdTicketId && signAttempted) {
        // Unknown outcome — poll instead of guessing. If the transfer actually landed, the
        // backend's burner-balance check promotes it to 'sent' on its own within a few seconds
        // and this poll picks that up; if it genuinely never went through, the ticket stays
        // pending_send and a backend cron cleans it up later (also balance-checked, same safety).
        pollStatus(createdTicketId);
      }
    }
  }

  // ── Purchase in progress ──────────────────────────────────────────────────
  if (isRunning) {
    return (
      <View style={styles.progressScreen}>
        <View style={styles.progressMain}>
          <Text style={styles.progressEmoji}>🎟️</Text>
          <Text style={styles.progressLabel}>{stepLabel[step] ?? t.stepProcessing}</Text>
          <Text style={styles.progressTitle}>{t.hangTight}</Text>
          <View style={styles.progressGate}>
            <Text style={styles.progressHint} numberOfLines={2}>
              {t.stealthPhrases[phraseIdx % t.stealthPhrases.length]}
            </Text>
          </View>
          {stuckHint && (
            <TouchableOpacity onPress={() => router.push('/history')}>
              <Text style={styles.stuckHint}>{t.takingLonger}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.progressSubHint}>{t.dontCloseApp}</Text>
      </View>
    );
  }

  // ── Just landed — confetti beat before the Good luck card ──────────────────
  if (step === 'done' && celebrating) {
    return <CelebrationScreen />;
  }

  // ── Purchase done — mirrors apps/frontend's DrawSuccessModal ────────────────
  if (step === 'done') {
    const showPicks = tickets.length > 0 && tickets[0].main.length > 0;
    const shownTickets = showAllTickets ? tickets : tickets.slice(0, 5);
    const prizePoolAmount = nextDraw.prizePool ? Math.round(parseFloat(nextDraw.prizePool)).toLocaleString(localeTag) : null;

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.doneScreen}>
        <TouchableOpacity style={styles.doneCloseButton} onPress={resetBuy}>
          <X size={20} color={color.fg3} />
        </TouchableOpacity>

        <View style={styles.doneHeader}>
          <Text style={styles.doneEmoji}>🎟️✨</Text>
          <Text style={styles.doneEyebrow}>{t.ticketsConfirmed}</Text>
          <GradientText
            style={styles.doneHeadline}
            colors={['#FFFFFF', '#F1F5F9', '#FDE68A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          >
            {t.goodLuck}
          </GradientText>
          {prizePoolAmount && <Text style={styles.donePrizePool}>{t.prizePoolSuffix(`$${prizePoolAmount}`)}</Text>}
        </View>

        <DrawInCountdown drawTime={nextDraw.drawTime} />

        {showPicks && (
          <View style={{ gap: space[2] }}>
            <Text style={styles.drawInLabel}>{t.yourTickets}</Text>
            {shownTickets.map((ticket, i) => (
              <TicketNumberCard key={i} tn={ticket} />
            ))}
            {!showAllTickets && tickets.length > 5 && (
              <TouchableOpacity style={styles.moreTicketsButton} onPress={() => setShowAllTickets(true)}>
                <Text style={styles.moreTicketsText}>{t.moreTickets(tickets.length - 5)}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.doneCheckBack}>{t.checkBackSoon}</Text>

        <GhostButton label={t.buyMoreTickets} onPress={resetBuy} />
      </ScrollView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  const base = numTickets * TICKET_PRICE_USDC;

  return (
    <View style={styles.screen}>
      <PrizePoolHero prizePool={nextDraw.prizePool} drawTime={nextDraw.drawTime} />

      <View style={styles.card}>
        <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.formTitle}>{t.buyTicketsPrivately}</Text>

          {/* Ticket count */}
          <View>
            <View style={styles.presetRow}>
              <Text style={styles.sectionTitle}>{t.ticketsFieldLabel}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {PRESETS.map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setTicketCount(n)}
                    style={[styles.presetChip, numTickets === n && styles.presetChipActive]}
                  >
                    <Text style={[styles.presetChipText, numTickets === n && styles.presetChipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepperButton} onPress={() => setTicketCount(numTickets - 1)}>
                <Text style={styles.stepperButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{numTickets}</Text>
              <TouchableOpacity style={styles.stepperButton} onPress={() => setTicketCount(numTickets + 1)}>
                <Text style={styles.stepperButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Choose numbers (cosmetic preview only — see comment near TicketNumbers above) */}
          {numTickets <= NUMBER_PICKER_LIMIT ? (
            <Card style={styles.chooseCard}>
              <TouchableOpacity style={styles.chooseHeader} onPress={() => setChooseOpen((o) => !o)}>
                <Text style={styles.chooseHeaderText}>{t.chooseNumbers}</Text>
                {chooseOpen ? <ChevronUp size={18} color={color.fg3} /> : <ChevronDown size={18} color={color.fg3} />}
              </TouchableOpacity>
              {chooseOpen && (
                <View style={styles.chooseBody}>
                  <TouchableOpacity style={styles.shuffleAllButton} onPress={() => setTickets(tickets.map(() => randomTicket()))}>
                    <Shuffle size={14} color={color.fg2} />
                    <Text style={styles.shuffleAllText}>{t.shuffleAll}</Text>
                  </TouchableOpacity>
                  <View style={styles.ticketList}>
                    {tickets.map((ticket, i) => (
                      <TouchableOpacity key={i} style={styles.ticketRow} onPress={() => setEditingIdx(i)}>
                        <View style={styles.ticketRowNumbers}>
                          {ticket.main.map((n) => (
                            <View key={n} style={styles.numberBubbleSmall}>
                              <Text style={styles.numberBubbleSmallText}>{n}</Text>
                            </View>
                          ))}
                          <View style={styles.bonusBubbleSmall}>
                            <Text style={styles.bonusBubbleSmallText}>{ticket.bonus}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.addTicketButton}
                    onPress={() => {
                      if (tickets.length >= NUMBER_PICKER_LIMIT) return;
                      setTicketCount(numTickets + 1);
                    }}
                  >
                    <Text style={styles.addTicketButtonText}>{t.addTicket}</Text>
                  </TouchableOpacity>
                  <Text style={styles.chooseHint}>{t.tapRowToEdit}</Text>
                </View>
              )}
            </Card>
          ) : (
            <View style={styles.field}>
              <Shuffle size={16} color={color.fg2} style={{ marginRight: 8 }} />
              <Text style={styles.fieldHint}>{t.numbersPickedRandomly(NUMBER_PICKER_LIMIT + 1)}</Text>
            </View>
          )}

          {/* Fee breakdown */}
          <View style={styles.feeCard}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>{t.ticketCount(numTickets)}</Text>
              <Text style={styles.feeValue}>{fmt(base, localeTag)}</Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>{t.privateTransferFee}</Text>
              <Text style={styles.feeValue}>{fmt(mbFee(base), localeTag)}</Text>
            </View>
            <View style={[styles.feeRow, styles.feeTotalRow]}>
              <Text style={styles.feeTotalLabel}>{t.total}</Text>
              <Text style={styles.feeTotalValue}>{fmt(cost, localeTag)}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.cardFooter}>
          {step === 'error' && stepError ? <Text style={styles.error}>{stepError}</Text> : null}
          <PrimaryButton onPress={handleBuy} label={t.payButton(fmt(cost, localeTag))} />
          <Text style={styles.shieldedNote}>{t.shieldedNote}</Text>
        </View>
      </View>

      {editingIdx !== null && (
        <NumberPickerModal
          visible
          ticket={tickets[editingIdx]}
          onSave={(updated) => updateTicket(editingIdx, updated)}
          onClose={() => setEditingIdx(null)}
        />
      )}
    </View>
  );
}

// ── Number picker modal (full screen) ───────────────────────────────────────

function NumberPickerModal({
  visible,
  ticket,
  onSave,
  onClose,
}: {
  visible: boolean;
  ticket: TicketNumbers;
  onSave: (t: TicketNumbers) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TicketNumbers>(ticket);
  useEffect(() => {
    if (visible) setDraft(ticket);
  }, [visible, ticket]);

  function toggleMain(n: number) {
    setDraft((d) => {
      if (d.main.includes(n)) return { ...d, main: d.main.filter((x) => x !== n) };
      if (d.main.length >= MAIN_COUNT) return { ...d, main: [...d.main.slice(0, -1), n].sort((a, b) => a - b) };
      return { ...d, main: [...d.main, n].sort((a, b) => a - b) };
    });
  }

  function toggleBonus(n: number) {
    setDraft((d) => ({ ...d, bonus: d.bonus === n ? 0 : n }));
  }

  const isComplete = draft.main.length === MAIN_COUNT && draft.bonus > 0;
  const mainRemaining = MAIN_COUNT - draft.main.length;
  const saveLabel = !isComplete ? t.pickerRemainingLabel(mainRemaining, draft.bonus === 0) : t.saveNumbers;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.pickerScreen}>
        <View style={styles.pickerHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerTitle}>{t.chooseNumbers}</Text>
            <Text style={styles.pickerProgress}>{t.pickerProgress(draft.main.length, MAIN_COUNT, draft.bonus > 0 ? 1 : 0)}</Text>
          </View>
          <View style={styles.pickerHeaderActions}>
            <TouchableOpacity onPress={() => setDraft(randomTicket())} style={styles.pickerIconButton}>
              <Shuffle size={18} color={color.fg2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.pickerIconButton}>
              <Text style={styles.pickerCloseGlyph}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.pickerBody}>
          <Text style={styles.pickerSectionLabel}>{t.mainNumbersPick(MAIN_COUNT)}</Text>
          <View style={styles.numberGrid}>
            {Array.from({ length: MAIN_MAX }, (_, i) => i + 1).map((n) => {
              const selected = draft.main.includes(n);
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => toggleMain(n)}
                  style={[styles.numberBubble, selected && styles.numberBubbleActive]}
                >
                  <Text style={[styles.numberBubbleText, selected && styles.numberBubbleTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.pickerSectionLabel}>{t.bonusNumberPick}</Text>
          <View style={styles.numberGrid}>
            {Array.from({ length: BONUS_MAX }, (_, i) => i + 1).map((n) => {
              const selected = draft.bonus === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => toggleBonus(n)}
                  style={[styles.numberBubble, selected && styles.numberBubbleActive]}
                >
                  <Text style={[styles.numberBubbleText, selected && styles.numberBubbleTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.pickerFooter}>
          <PrimaryButton
            disabled={!isComplete}
            label={saveLabel}
            onPress={() => {
              onSave(draft);
              onClose();
            }}
          />
          <TouchableOpacity onPress={onClose} style={styles.pickerCancel}>
            <Text style={styles.pickerCancelText}>{t.cancel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function BuyScreen() {
  return (
    <View style={styles.container}>
      <AuthGate>
        <BuyScreenInner />
      </AuthGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bgInk },
  screen: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[2] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgInk, padding: space[6], gap: 10 },
  progressScreen: { flex: 1, alignItems: 'center', backgroundColor: color.bgInk, paddingHorizontal: space[6], paddingTop: space[6], paddingBottom: space[8] },

  celebrationScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgInk, gap: space[2] },
  celebrationEmoji: { fontSize: 64 },
  celebrationTitle: { color: color.fg, fontSize: 26, fontFamily: FONT_TITLE },
  celebrationSubtitle: { color: color.fg3, fontSize: 15, fontFamily: FONT_BODY_MEDIUM },
  confettiPiece: { position: 'absolute', top: 0, width: 8, height: 14, borderRadius: 2 },
  progressStatusBar: { width: '100%', alignItems: 'center', gap: space[2] },
  progressStatusText: { color: color.warn, fontSize: 14, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressMain: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 8 },
  progressEmoji: { fontSize: 56 },
  progressLabel: { color: color.warn, fontSize: 14, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressTitle: { color: color.fg, fontSize: 28, fontFamily: FONT_TITLE },
  progressGate: { width: '100%', alignItems: 'center', gap: space[4], marginTop: space[2] },
  progressHint: {
    color: color.fg2,
    fontSize: 19,
    lineHeight: 24,
    minHeight: 48,
    fontFamily: FONT_BODY_MEDIUM,
    textAlign: 'center',
  },
  progressSubHint: { color: color.fg3, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },

  // Prize pool
  prizePool: { alignItems: 'center', paddingVertical: space[2] },
  prizePoolLabel: { color: color.fg3, fontFamily: FONT_BODY_BOLD, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 },
  prizePoolAmount: { color: color.fg, fontFamily: FONT_TITLE, fontSize: 48 },
  countdownRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: space[4] },

  // Unified card
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.xl,
    backgroundColor: color.surface1,
    overflow: 'hidden',
  },
  cardScroll: { padding: space[5], paddingBottom: space[2], gap: space[4] },
  cardFooter: { padding: space[5], paddingTop: space[2], gap: 10 },

  formTitle: { color: color.fg, fontSize: 22, fontFamily: FONT_TITLE_SEMIBOLD },
  shieldedNote: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center', marginTop: 2 },
  sectionTitle: { color: '#e2e8f0', fontSize: 17, fontFamily: FONT_BODY_SEMIBOLD },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md + 2,
    backgroundColor: color.surface3,
    paddingHorizontal: space[4],
    paddingVertical: space[4] - 2,
    gap: space[3],
  },
  fieldHint: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, marginTop: 2, flexShrink: 1 },

  presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: color.borderSoft, backgroundColor: color.surface1 },
  presetChipActive: { backgroundColor: 'rgba(255,74,38,0.16)', borderColor: color.brandOrange },
  presetChipText: { color: '#cbd5e1', fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  presetChipTextActive: { color: color.brandOrange },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md + 2, backgroundColor: color.surface1, overflow: 'hidden' },
  stepperButton: { width: 56, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { color: '#e2e8f0', fontSize: 24 },
  stepperValue: { flex: 1, textAlign: 'center', color: color.fg, fontSize: 22, fontFamily: FONT_BODY_BOLD },

  // Choose numbers
  chooseCard: { padding: 0 },
  chooseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[4] },
  chooseHeaderText: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },
  chooseBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: color.borderSofter, paddingTop: space[3] },
  shuffleAllButton: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] },
  shuffleAllText: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY_MEDIUM },
  ticketList: { borderWidth: 1, borderColor: color.borderSofter, borderRadius: radius.md, overflow: 'hidden' },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space[3], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: color.borderSofter },
  ticketRowNumbers: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 6 },
  numberBubbleSmall: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: color.surface3, alignItems: 'center', justifyContent: 'center' },
  numberBubbleSmallText: { color: color.fg, fontSize: 13, fontFamily: FONT_BODY_BOLD },
  bonusBubbleSmall: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: color.fg, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  bonusBubbleSmallText: { color: color.bgInk, fontSize: 13, fontFamily: FONT_BODY_BOLD },
  addTicketButton: { alignItems: 'center', paddingVertical: space[3], borderWidth: 1, borderColor: color.borderSofter, borderRadius: radius.md },
  addTicketButtonText: { color: color.fg2, fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  chooseHint: { color: color.fg4, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center' },

  feeCard: {
    borderWidth: 1,
    borderColor: color.borderSofter,
    borderRadius: radius.md + 2,
    backgroundColor: color.surface1,
    overflow: 'hidden',
  },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  feeLabel: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY },
  feeValue: { color: '#e2e8f0', fontSize: 15, fontFamily: FONT_BODY_MEDIUM },
  feeTotalRow: { borderTopWidth: 1, borderTopColor: color.borderSofter, marginTop: 4, paddingTop: space[3], paddingBottom: space[4] - 2 },
  feeTotalLabel: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },
  feeTotalValue: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },

  error: { color: color.danger, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },

  stuckHint: { color: color.brandOrange, fontSize: 16, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center', textDecorationLine: 'underline', marginTop: space[2] },

  // number picker (full screen)
  pickerScreen: { flex: 1, backgroundColor: color.bgInk, paddingTop: 60 },
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space[5], paddingBottom: space[4] - 2, borderBottomWidth: 1, borderBottomColor: color.borderSofter, gap: space[3] },
  pickerTitle: { color: color.fg, fontSize: 20, fontFamily: FONT_TITLE_SEMIBOLD },
  pickerProgress: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY, marginTop: 4 },
  pickerHeaderActions: { flexDirection: 'row', gap: space[2] },
  pickerIconButton: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft, alignItems: 'center', justifyContent: 'center' },
  pickerCloseGlyph: { color: color.fg2, fontSize: 16 },
  pickerBody: { padding: space[5], gap: space[5] },
  pickerSectionLabel: { color: '#e2e8f0', fontSize: 14, fontFamily: FONT_BODY_SEMIBOLD, marginBottom: 10 },
  numberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  numberBubble: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },
  numberBubbleActive: { backgroundColor: color.brandOrange, borderColor: color.brandOrange },
  numberBubbleText: { color: '#cbd5e1', fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },
  numberBubbleTextActive: { color: color.fg },
  pickerFooter: { padding: space[5], gap: 8, borderTopWidth: 1, borderTopColor: color.borderSofter },
  pickerCancel: { alignItems: 'center', paddingVertical: 10 },
  pickerCancelText: { color: color.fg3, fontSize: 15, fontFamily: FONT_BODY },

  // Purchase done — mirrors DrawSuccessModal
  doneScreen: { padding: space[5], paddingTop: space[2], gap: space[5], flexGrow: 1 },
  doneCloseButton: { alignSelf: 'flex-end', padding: space[2] },
  doneHeader: { alignItems: 'center', gap: space[2] },
  doneEmoji: { fontSize: 52 },
  doneEyebrow: { color: color.success, fontFamily: FONT_BODY_BOLD, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', marginTop: 4 },
  doneHeadline: { fontFamily: FONT_TITLE, fontSize: 40, textAlign: 'center' },
  donePrizePool: { color: '#fcd34d', fontFamily: FONT_BODY_SEMIBOLD, fontSize: 17 },
  drawInLabel: { color: color.fg2, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' },
  drawLocalText: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 13, textAlign: 'center', marginTop: 2 },

  numberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.md + 2,
    backgroundColor: color.surface1,
    paddingHorizontal: space[3],
    minHeight: 58,
  },
  numberCardMain: { flex: 1, gap: 6, paddingVertical: space[3] },
  numberCardLabel: { color: color.fg4, fontFamily: FONT_BODY_BOLD, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' },
  numberCardMainRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  numberCardDigit: { color: color.fg2, fontFamily: FONT_BODY_BOLD, fontSize: 14, fontVariant: ['tabular-nums'] },
  numberCardDivider: { alignSelf: 'stretch', width: 1, borderLeftWidth: 1, borderLeftColor: color.borderSoft, borderStyle: 'dashed', marginHorizontal: space[2] },
  numberCardBonusCol: { alignItems: 'center', gap: 6, paddingVertical: space[3] },
  numberCardBonusCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center' },
  numberCardBonusText: { color: '#fbbf24', fontFamily: FONT_BODY_BOLD, fontSize: 13, fontVariant: ['tabular-nums'] },

  moreTicketsButton: { alignItems: 'center', paddingVertical: space[2] + 2, borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md + 2 },
  moreTicketsText: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 14 },
  doneCheckBack: { color: '#cbd5e1', fontFamily: FONT_BODY_MEDIUM, fontSize: 16, textAlign: 'center' },
});
