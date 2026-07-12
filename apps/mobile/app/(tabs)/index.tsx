import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Shuffle } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../../components/AuthGate';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Card } from '../../components/ui/Card';
import { CountdownTile } from '../../components/ui/CountdownTile';
import { GradientText } from '../../components/ui/GradientText';
import { buyTickets, cancelTicket, confirmBuy, getDashboard, getTicketStatus, type TicketStatus } from '../../lib/api/lottery';
import { fmt, mbFee, totalCost, TICKET_PRICE_USDC } from '../../lib/lottery/fees';
import { connectSeekerWallet, signAndSendTransactionWithSeeker } from '../../lib/wallet/mwa';
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
    { v: pad(cd.h), l: 'HRS' },
    { v: pad(cd.m), l: 'MIN' },
    { v: pad(cd.s), l: 'SEC' },
  ];

  return (
    <View style={styles.prizePool}>
      <Text style={styles.prizePoolLabel}>Prize Pool</Text>
      <GradientText
        style={styles.prizePoolAmount}
        colors={['#FFFFFF', '#F1F5F9', '#FDE68A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        {`$${amount.toLocaleString('en-US')}`}
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

type BuyStep = 'idle' | 'signing' | 'sent' | 'bridging' | 'buying' | 'done' | 'error';

const STEP_LABEL: Partial<Record<BuyStep, string>> = {
  signing: 'Confirm in your wallet',
  sent: 'Payment sent',
  bridging: 'Bridging to Base',
  buying: 'Buying your tickets',
};

// Same copy as apps/frontend/src/app/app/megapot/page.tsx's PurchaseProgressModal — cycled every
// 3.5s while a purchase is in flight, purely cosmetic (independent of actual progress).
const STEALTH_PHRASES = [
  'nobody will know about your gambling addiction 🤫',
  "shh, it's between us 🤐",
  'ninjas are moving your money to megapot 🥷',
  'printing tickets in the basement... 🎟️',
  'cutting through back alleys so nobody can trace it 🕵️',
];

const STATUS_TO_STEP: Partial<Record<TicketStatus, BuyStep>> = {
  sent: 'sent',
  bridging: 'bridging',
  buying: 'buying',
  active: 'done',
  won: 'done',
  failed: 'error',
};

function BuyScreenInner() {
  const { getAccessToken } = usePrivy();
  const router = useRouter();

  const [numTickets, setNumTicketsRaw] = useState(5);
  const [tickets, setTickets] = useState<TicketNumbers[]>(() => Array.from({ length: 5 }, randomTicket));
  const [chooseOpen, setChooseOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

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
        }
        if (next) setStep(next);
      } catch {
        // transient — next tick / next foreground will retry
      }
    },
    [getAccessToken, stopPoll],
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

  // Cosmetic phrase rotation, only while a purchase is actually in flight.
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % STEALTH_PHRASES.length), 3_500);
    return () => clearInterval(id);
  }, [isRunning]);

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
      const { base58Address } = await connectSeekerWallet();
      accessToken = await getAccessToken();

      // Only the MagicBlock private transfer to sign now — no separate Loofta fee tx.
      const { ticketId, txBase64 } = await buyTickets(numTickets, base58Address, accessToken);
      createdTicketId = ticketId;
      signAttempted = true;
      const signature = await signAndSendTransactionWithSeeker(txBase64);
      setStep('sent');
      await confirmBuy(ticketId, signature, accessToken);
      pollStatus(ticketId);
    } catch (e: any) {
      setStep('error');
      setStepError(e?.message ?? 'Unknown error');
      if (createdTicketId && !signAttempted) {
        // Never reached the wallet prompt at all (e.g. ticket creation itself failed) — no
        // signature could possibly exist, safe to cancel outright.
        cancelTicket(createdTicketId, accessToken)
          .then(() => cancelTicket(createdTicketId!, accessToken))
          .catch(() => {});
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
          <Text style={styles.progressLabel}>{STEP_LABEL[step] ?? 'Processing'}</Text>
          <Text style={styles.progressTitle}>Hang tight</Text>
          <Text style={styles.progressHint}>{STEALTH_PHRASES[phraseIdx]}</Text>
          {stuckHint && (
            <TouchableOpacity onPress={() => router.push('/history')}>
              <Text style={styles.stuckHint}>Taking longer than usual — check History for status</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.progressSubHint}>🔒 Don&apos;t close the app — usually under 3 minutes.</Text>
      </View>
    );
  }

  // ── Purchase done ──────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.progressEmoji}>🎉</Text>
        <Text style={styles.progressTitle}>You&apos;re in the draw!</Text>
        <PrimaryButton label="Buy more" onPress={resetBuy} />
      </View>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  const base = numTickets * TICKET_PRICE_USDC;

  return (
    <View style={styles.screen}>
      <PrizePoolHero prizePool={nextDraw.prizePool} drawTime={nextDraw.drawTime} />

      <View style={styles.card}>
        <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.formTitle}>Buy tickets privately</Text>

          {/* Ticket count */}
          <View>
            <View style={styles.presetRow}>
              <Text style={styles.sectionTitle}>Tickets</Text>
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
                <Text style={styles.chooseHeaderText}>Choose numbers</Text>
                {chooseOpen ? <ChevronUp size={18} color={color.fg3} /> : <ChevronDown size={18} color={color.fg3} />}
              </TouchableOpacity>
              {chooseOpen && (
                <View style={styles.chooseBody}>
                  <TouchableOpacity style={styles.shuffleAllButton} onPress={() => setTickets(tickets.map(() => randomTicket()))}>
                    <Shuffle size={14} color={color.fg2} />
                    <Text style={styles.shuffleAllText}>Shuffle all</Text>
                  </TouchableOpacity>
                  <View style={styles.ticketList}>
                    {tickets.map((t, i) => (
                      <TouchableOpacity key={i} style={styles.ticketRow} onPress={() => setEditingIdx(i)}>
                        <View style={styles.ticketRowNumbers}>
                          {t.main.map((n) => (
                            <View key={n} style={styles.numberBubbleSmall}>
                              <Text style={styles.numberBubbleSmallText}>{n}</Text>
                            </View>
                          ))}
                          <View style={styles.ticketDivider} />
                          <View style={styles.bonusBubbleSmall}>
                            <Text style={styles.bonusBubbleSmallText}>{t.bonus}</Text>
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
                    <Text style={styles.addTicketButtonText}>+  Add ticket</Text>
                  </TouchableOpacity>
                  <Text style={styles.chooseHint}>Tap any row to edit numbers</Text>
                </View>
              )}
            </Card>
          ) : (
            <View style={styles.field}>
              <Shuffle size={16} color={color.fg2} style={{ marginRight: 8 }} />
              <Text style={styles.fieldHint}>Numbers picked randomly for {NUMBER_PICKER_LIMIT + 1}+ tickets</Text>
            </View>
          )}

          {/* Fee breakdown */}
          <View style={styles.feeCard}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>{numTickets} ticket{numTickets === 1 ? '' : 's'}</Text>
              <Text style={styles.feeValue}>{fmt(base)}</Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Private transfer fee</Text>
              <Text style={styles.feeValue}>{fmt(mbFee(base))}</Text>
            </View>
            <View style={[styles.feeRow, styles.feeTotalRow]}>
              <Text style={styles.feeTotalLabel}>Total</Text>
              <Text style={styles.feeTotalValue}>{fmt(cost)}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.cardFooter}>
          {step === 'error' && stepError ? <Text style={styles.error}>{stepError}</Text> : null}
          <PrimaryButton onPress={handleBuy} label={`Pay ${fmt(cost)}`} />
          <Text style={styles.shieldedNote}>🔒 Shielded via MagicBlock. Paid from your Seeker wallet.</Text>
        </View>
      </View>

      {editingIdx !== null && (
        <NumberPickerModal
          visible
          ticket={tickets[editingIdx]}
          onSave={(t) => updateTicket(editingIdx, t)}
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
  const saveLabel = !isComplete
    ? [mainRemaining > 0 && `${mainRemaining} main`, draft.bonus === 0 && 'bonus'].filter(Boolean).join(' + ') + ' left'
    : 'Save numbers';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.pickerScreen}>
        <View style={styles.pickerHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerTitle}>Choose numbers</Text>
            <Text style={styles.pickerProgress}>{draft.main.length}/{MAIN_COUNT} main · {draft.bonus > 0 ? 1 : 0}/1 bonus</Text>
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
          <Text style={styles.pickerSectionLabel}>Main numbers (pick {MAIN_COUNT})</Text>
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

          <Text style={styles.pickerSectionLabel}>Bonus number (pick 1)</Text>
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
            <Text style={styles.pickerCancelText}>Cancel</Text>
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
  progressScreen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.bgInk, paddingHorizontal: space[6], paddingTop: space[8], paddingBottom: space[8] },
  progressMain: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },

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
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: space[3] + 2, paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: color.borderSofter },
  ticketRowNumbers: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  ticketDivider: { width: 1, height: 24, backgroundColor: color.borderSoft, marginHorizontal: 4 },
  numberBubbleSmall: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.surface3, alignItems: 'center', justifyContent: 'center' },
  numberBubbleSmallText: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_BOLD },
  bonusBubbleSmall: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.fg, alignItems: 'center', justifyContent: 'center' },
  bonusBubbleSmallText: { color: color.bgInk, fontSize: 15, fontFamily: FONT_BODY_BOLD },
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
  feeLabel: { color: color.fg2, fontSize: 14, fontFamily: FONT_BODY },
  feeValue: { color: '#e2e8f0', fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  feeTotalRow: { borderTopWidth: 1, borderTopColor: color.borderSofter, marginTop: 4, paddingTop: space[3], paddingBottom: space[4] - 2 },
  feeTotalLabel: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },
  feeTotalValue: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },

  error: { color: color.danger, fontSize: 13, fontFamily: FONT_BODY, textAlign: 'center' },

  progressEmoji: { fontSize: 56 },
  progressLabel: { color: color.warn, fontSize: 14, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressTitle: { color: color.fg, fontSize: 28, fontFamily: FONT_TITLE },
  progressHint: { color: color.fg2, fontSize: 16, fontFamily: FONT_BODY, textAlign: 'center' },
  progressSubHint: { color: color.fg3, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },
  stuckHint: { color: color.brandOrange, fontSize: 15, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center', textDecorationLine: 'underline', marginTop: space[2] },

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
});
