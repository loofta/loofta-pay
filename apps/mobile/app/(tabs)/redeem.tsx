import { usePrivy } from '@privy-io/expo';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Download, ShieldCheck, Trophy } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../../components/AuthGate';
import { GhostButton } from '../../components/ui/GhostButton';
import { GradientText } from '../../components/ui/GradientText';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { getBridgeFee, getDashboard, playAgain, withdrawBatch, type LotteryTicketSummary, type LotteryWithdrawalSummary } from '../../lib/api/lottery';
import { fmt, DEFAULT_WITHDRAW_MIN_USDC, WITHDRAW_FEATURED_THRESHOLD_USDC, isFreeTicketAmount } from '../../lib/lottery/fees';
import { connectSeekerWallet } from '../../lib/wallet/mwa';
import { updateCachedSkrDomain } from '../../lib/storage/seekerIdentity';
import { color, radius, space } from '../../lib/theme';
import { FONT_TITLE, FONT_TITLE_SEMIBOLD, FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from '../../lib/fonts';

/** Presentational only — mirrors the date format used elsewhere on the dashboard. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ── Dev-only preview data — mirrors apps/frontend's PREVIEW_WON_TICKETS/PREVIEW_TICKETS exactly
// (same amounts/tiers), so mobile and desktop show identical numbers when previewing. ──
const PREVIEW_TICKET_NUMBERS = [
  { main: [3, 11, 19, 24, 30], bonus: 7 },
  { main: [1, 8, 15, 22, 29], bonus: 3 },
  { main: [5, 12, 17, 21, 26], bonus: 11 },
];

function previewWonTicket(overrides: Partial<LotteryTicketSummary> & { id: string }): LotteryTicketSummary {
  return {
    status: 'won',
    numTickets: 1,
    costUsdc: 1,
    roundId: '412',
    drawTime: null,
    winAmountUsdc: 0,
    winTier: null,
    createdAt: new Date().toISOString(),
    depositAddress: null,
    bridgeStatus: 'DONE',
    bridgeExpiresAt: null,
    ticketNumbers: PREVIEW_TICKET_NUMBERS,
    winningNumbers: null,
    isGift: false,
    ...overrides,
  };
}

const PREVIEW_WON_TICKETS: LotteryTicketSummary[] = [
  previewWonTicket({ id: 'preview-won-1', numTickets: 5, costUsdc: 5, winAmountUsdc: 272.39, winTier: 2 }),
  previewWonTicket({ id: 'preview-won-2', numTickets: 1, costUsdc: 1, winAmountUsdc: 12.5, winTier: 4, roundId: '411' }),
  previewWonTicket({ id: 'preview-won-3', numTickets: 10, costUsdc: 10, winAmountUsdc: 3.75, winTier: 5, roundId: '410' }),
];

type PreviewMode = 'redeem' | 'redeem-batch' | 'redeem-on-the-way' | 'redeem-complete' | 'played-again-5' | null;

const DEV_PREVIEW_OPTIONS: { key: PreviewMode; label: string }[] = [
  { key: 'redeem', label: 'Redeem — 1 win' },
  { key: 'redeem-batch', label: 'Redeem — batch' },
  { key: 'redeem-on-the-way', label: 'Redeem — on the way' },
  { key: 'redeem-complete', label: 'Redeem — complete' },
  { key: 'played-again-5', label: 'Played again — 5 tickets' },
  { key: null, label: 'Reset (live data)' },
];

/** Dev-only preview panel — mirrors apps/frontend's DevPreviewPanel (IS_LOCALHOST-gated) so every
 *  Redeem UI state can be inspected without needing a real win/withdrawal. Never rendered when
 *  __DEV__ is false (production/TestFlight/etc.). */
function DevPreviewPanel({ mode, onSelect }: { mode: PreviewMode; onSelect: (m: PreviewMode) => void }) {
  if (!__DEV__) return null;
  return (
    <View style={styles.devPanel}>
      <Text style={styles.devPanelTitle}>DEV PREVIEW</Text>
      <View style={styles.devPanelRow}>
        {DEV_PREVIEW_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={String(opt.key)}
            style={[styles.devPanelChip, mode === opt.key && styles.devPanelChipActive]}
            onPress={() => onSelect(opt.key)}
          >
            <Text style={[styles.devPanelChipText, mode === opt.key && styles.devPanelChipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/** Solid emerald→teal gradient — a scoped exception to the app's "solid orange only" button rule,
 *  matching desktop's redeem CTA exactly (`bg-gradient-to-r from-emerald-500 to-teal-400`). Money
 *  coming back to the user reads as a distinct, deliberately different action from spending. */
function RedeemGradientButton({ onPress, disabled, children }: { onPress?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={disabled ? { opacity: 0.4 } : undefined}>
      <LinearGradient colors={['#10b981', '#2dd4bf']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.redeemGradientButton}>
        {children}
      </LinearGradient>
    </TouchableOpacity>
  );
}

/** Redeemed → Traveling privately → In your wallet — mirrors desktop's 3-step tracker exactly. */
function WithdrawalProgressTracker({ arrived }: { arrived: boolean }) {
  type StepState = 'done' | 'active' | 'pending';
  const steps: { label: string; state: StepState }[] = [
    { label: 'Redeemed', state: 'done' },
    { label: 'Traveling privately', state: arrived ? 'done' : 'active' },
    { label: 'In your wallet', state: arrived ? 'done' : 'pending' },
  ];
  return (
    <View style={styles.trackerRow}>
      {steps.map((s, i) => (
        <View key={s.label} style={styles.trackerStepWrap}>
          <View style={styles.trackerStepCol}>
            <View
              style={[
                styles.trackerDot,
                s.state === 'done' && styles.trackerDotDone,
                s.state === 'active' && styles.trackerDotActive,
                s.state === 'pending' && styles.trackerDotPending,
              ]}
            >
              {s.state === 'done' ? (
                <Check size={14} color="#fff" strokeWidth={3} />
              ) : s.state === 'active' ? (
                <View style={styles.trackerPulseDot} />
              ) : (
                <View style={styles.trackerPendingDot} />
              )}
            </View>
            <Text style={[styles.trackerLabel, s.state === 'pending' && styles.trackerLabelPending]}>{s.label}</Text>
          </View>
          {i < steps.length - 1 && <View style={[styles.trackerLine, s.state === 'done' && styles.trackerLineDone]} />}
        </View>
      ))}
    </View>
  );
}

function RedeemInner() {
  const { getAccessToken } = usePrivy();

  const [loading, setLoading] = useState(true);
  const [wonTickets, setWonTickets] = useState<LotteryTicketSummary[]>([]);
  const [withdrawMin, setWithdrawMin] = useState(DEFAULT_WITHDRAW_MIN_USDC);
  const [error, setError] = useState<string | null>(null);
  // Past redeemed tickets, sourced from the same dashboard fetch below — used only to render the
  // "Earlier" list, no extra API call.
  const [earlierTickets, setEarlierTickets] = useState<LotteryTicketSummary[]>([]);

  const [feeLoading, setFeeLoading] = useState(false);
  const [feeUsd, setFeeUsd] = useState<number | null>(null);
  const [receiveUsdc, setReceiveUsdc] = useState<number | null>(null);
  const [feeUnavailable, setFeeUnavailable] = useState(false);

  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [withdrawalIds, setWithdrawalIds] = useState<string[]>([]);
  const [doneAmount, setDoneAmount] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [transferFailed, setTransferFailed] = useState(false);

  const [playingAgain, setPlayingAgain] = useState(false);
  const [playAgainDone, setPlayAgainDone] = useState<{ numTickets: number } | null>(null);
  const [playAgainError, setPlayAgainError] = useState<string | null>(null);
  const [confirmingRedeem, setConfirmingRedeem] = useState(false);

  const [previewMode, setPreviewMode] = useState<PreviewMode>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => () => stopPoll(), [stopPoll]);

  const loadDashboard = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      const dashboard = await getDashboard(accessToken);
      const won = [...dashboard.activeTickets, ...dashboard.history].filter((t) => t.status === 'won');
      setWonTickets(won);
      setWithdrawMin(dashboard.withdrawMinUsdc ?? DEFAULT_WITHDRAW_MIN_USDC);
      setEarlierTickets(dashboard.history.filter((t) => t.status === 'withdrawn'));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load winnings');
    }
  }, [getAccessToken]);

  useEffect(() => {
    setLoading(true);
    loadDashboard().finally(() => setLoading(false));
  }, [loadDashboard]);

  // "Check results when the user opens the app" — results resolve server-side on a cron
  // independent of any client request, so the only thing mobile can (and should) do is make sure
  // it's never showing stale data: refetch whenever the app comes back to the foreground, not
  // just once on mount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadDashboard();
    });
    return () => sub.remove();
  }, [loadDashboard]);

  // Dev-only: force each UI state on demand instead of the real fetched data.
  useEffect(() => {
    if (previewMode === 'redeem') setWonTickets(PREVIEW_WON_TICKETS.slice(0, 1));
    else if (previewMode === 'redeem-batch') setWonTickets(PREVIEW_WON_TICKETS);
    else if (previewMode === 'played-again-5') setPlayAgainDone({ numTickets: 5 });
    else if (previewMode === 'redeem-on-the-way' || previewMode === 'redeem-complete') {
      setWithdrawalIds(['preview-withdrawal']);
      setDoneAmount(272.39);
      setArrived(previewMode === 'redeem-complete');
    } else if (previewMode === null) {
      setPlayAgainDone(null);
      setWithdrawalIds([]);
      setArrived(false);
      loadDashboard();
    }
  }, [previewMode, loadDashboard]);

  const totalAmount = wonTickets.reduce((sum, t) => sum + (t.winAmountUsdc ?? 0), 0);
  const isBatch = wonTickets.length > 1;
  // Play-again ticket count, matching the backend playAgain rule: a cash win (≥ withdrawMin) is
  // ROUNDED UP (backend funds the <$1 gap from the fee wallet); a free-ticket win (< withdrawMin)
  // is floored (backend sweeps the small change to us — no round-up when there's no withdraw).
  const playAgainTicketCount = wonTickets.reduce((sum, t) => {
    const n = t.winAmountUsdc ?? 0;
    return sum + (n >= withdrawMin ? Math.max(1, Math.ceil(n)) : Math.floor(n));
  }, 0);
  const canPlayAgain = wonTickets.some((t) => (t.winAmountUsdc ?? 0) > 0);
  const isFreeTicket = isFreeTicketAmount(totalAmount, withdrawMin) && canPlayAgain;
  // A win large enough to matter shouldn't default to steering the user back into another draw —
  // feature Withdraw instead and demote Play again to the secondary link.
  const preferWithdraw = !isFreeTicket && canPlayAgain && totalAmount >= WITHDRAW_FEATURED_THRESHOLD_USDC;

  useEffect(() => {
    if (!totalAmount || previewMode) return;
    let cancelled = false;
    setFeeLoading(true);
    setFeeUnavailable(false);
    (async () => {
      const accessToken = await getAccessToken();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));
        try {
          const { feeUsd, receiveUsdc } = await getBridgeFee(totalAmount, accessToken);
          if (cancelled) return;
          setFeeUsd(feeUsd);
          setReceiveUsdc(receiveUsdc);
          setFeeLoading(false);
          return;
        } catch {
          // try again
        }
      }
      if (!cancelled) {
        setFeeUnavailable(true);
        setFeeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [totalAmount, getAccessToken, previewMode]);

  // Poll withdrawal completion once redeem is submitted.
  useEffect(() => {
    if (!withdrawalIds.length || arrived || transferFailed || previewMode) return;
    const id = setInterval(async () => {
      try {
        const accessToken = await getAccessToken();
        const dashboard = await getDashboard(accessToken);
        const mine = dashboard.withdrawals.filter((w) => withdrawalIds.includes(w.id));
        if (!mine.length) return;
        if (mine.some((w: LotteryWithdrawalSummary) => w.status === 'failed')) {
          setTransferFailed(true);
        } else if (mine.every((w: LotteryWithdrawalSummary) => w.status === 'complete')) {
          const delivered = mine.reduce((s, w) => s + (w.amountUsdc ?? 0), 0);
          if (delivered > 0) setDoneAmount(delivered);
          setArrived(true);
        }
      } catch {
        // keep polling
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [withdrawalIds, arrived, transferFailed, getAccessToken, previewMode]);

  async function handleRedeem() {
    if (!wonTickets.length) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      const { base58Address, label } = await connectSeekerWallet();
      void updateCachedSkrDomain(label);
      const accessToken = await getAccessToken();
      const { withdrawalIds: ids } = await withdrawBatch(wonTickets.map((t) => t.id), base58Address, accessToken);
      setWithdrawalIds(ids);
      setDoneAmount(receiveUsdc ?? totalAmount);
    } catch (e: any) {
      setRedeemError(e?.message ?? 'Unknown error');
    } finally {
      setRedeeming(false);
    }
  }

  /** Claims + reinvests every currently-won ticket via its own companion wallet — no bridge, no
   *  fee. One call per ticket (play-again is inherently per-companion-wallet). */
  async function handlePlayAgain() {
    if (!wonTickets.length) return;
    setPlayingAgain(true);
    setPlayAgainError(null);
    try {
      const accessToken = await getAccessToken();
      let numTickets = 0;
      for (const t of wonTickets) {
        const result = await playAgain(t.id, accessToken);
        numTickets += result.numTickets;
      }
      setPlayAgainDone({ numTickets });
      loadDashboard();
    } catch (e: any) {
      setPlayAgainError(e?.message ?? 'Unknown error');
    } finally {
      setPlayingAgain(false);
    }
  }

  const earlierSection = earlierTickets.length > 0 && (
    <View style={styles.earlierSection}>
      <Text style={styles.earlierTitle}>Earlier</Text>
      <View style={styles.earlierList}>
        {earlierTickets.map((t, i) => (
          <View key={t.id} style={[styles.earlierRow, i === earlierTickets.length - 1 && styles.earlierRowLast]}>
            <Text style={styles.earlierRowText} numberOfLines={1}>
              Draw #{t.roundId ?? '—'} · Redeemed {formatDate(t.createdAt)}
            </Text>
            <Text style={styles.earlierRowAmount}>+{fmt(t.winAmountUsdc ?? 0)}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const devPanel = <DevPreviewPanel mode={previewMode} onSelect={setPreviewMode} />;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.brandOrange} />
        {devPanel}
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        {devPanel}
      </View>
    );
  }

  // ── Redeem in flight / done — mirrors desktop's 2-substate tracker card exactly ────────────
  if (withdrawalIds.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneEmoji}>{arrived ? '🎉' : '🛡️✨'}</Text>
        <Text style={styles.progressLabel}>{arrived ? 'Withdrawal complete' : 'Withdrawal on its way'}</Text>
        <GradientText
          style={styles.progressTitle}
          colors={['#FFFFFF', '#F1F5F9', '#6EE7B7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          {fmt(doneAmount)}
        </GradientText>
        <Text style={styles.progressSubtitle}>{arrived ? 'is in your wallet' : 'is heading to your wallet'}</Text>
        <Text style={styles.progressHint}>
          {arrived
            ? 'Delivered privately to your wallet — no on-chain link back to you.'
            : 'Arrives in a few minutes. No on-chain link back to you.'}
        </Text>
        {transferFailed && (
          <Text style={styles.error}>Something went wrong in transit — your funds are safe. Check History or contact support.</Text>
        )}

        <WithdrawalProgressTracker arrived={arrived} />

        <View style={{ gap: space[2], alignItems: 'center' }}>
          {!arrived && !transferFailed && <Text style={styles.leavePageHint}>You can safely leave this page — it continues in the background.</Text>}
          <TouchableOpacity
            onPress={() => {
              setWithdrawalIds([]);
              setDoneAmount(0);
              setArrived(false);
              setTransferFailed(false);
              setPreviewMode(null);
            }}
          >
            <Text style={styles.backLink}>Back to redeem</Text>
          </TouchableOpacity>
        </View>
        {devPanel}
      </View>
    );
  }

  // ── Played again ────────────────────────────────────────────────────────
  if (playAgainDone) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneEmoji}>🎟️</Text>
        <Text style={styles.progressLabel}>Played again</Text>
        <GradientText
          style={styles.progressTitle}
          colors={['#FFFFFF', '#F1F5F9', '#6EE7B7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          {`${playAgainDone.numTickets} new ticket${playAgainDone.numTickets === 1 ? '' : 's'}`}
        </GradientText>
        <Text style={styles.progressHint}>Your winnings went straight back into the next draw — no fees.</Text>
        <TouchableOpacity onPress={() => { setPlayAgainDone(null); setPreviewMode(null); }}>
          <Text style={styles.backLink}>Back</Text>
        </TouchableOpacity>
        {devPanel}
      </View>
    );
  }

  // ── No winnings ──────────────────────────────────────────────────────────
  if (!wonTickets.length) {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Redeem</Text>
          <View style={styles.emptyWrap}>
            <View style={[styles.iconCircle, styles.iconCircleMuted]}>
              <Trophy size={26} color={color.fg3} />
            </View>
            <Text style={styles.emptyTitle}>No winnings yet</Text>
            <Text style={styles.emptySubtitle}>Win the daily draw and your prize lands here, ready to redeem privately.</Text>
          </View>
          {earlierSection}
        </ScrollView>
        {devPanel}
      </View>
    );
  }

  // ── Ready to redeem — mirrors desktop's WithdrawTab hero card exactly ──────────────────────
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Redeem</Text>

        <LinearGradient
          colors={['rgba(16,185,129,0.07)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)']}
          style={styles.heroCard}
        >
          <Text style={styles.heroEmoji}>🏆</Text>
          <Text style={styles.heroEyebrow}>{isBatch ? `${wonTickets.length} winning draws` : 'You won'}</Text>
          {isFreeTicket ? (
            <Text style={styles.heroAmount}>Free ticket</Text>
          ) : (
            <GradientText
              style={styles.heroAmount}
              colors={['#FFFFFF', '#D1FAE5', '#6EE7B7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            >
              {fmt(totalAmount)}
            </GradientText>
          )}
          <Text style={styles.heroSubtitle}>{isFreeTicket ? 'play it again in the next draw' : 'ready to redeem privately'}</Text>

          <View style={styles.winsList}>
            <Text style={styles.winsLabel}>Your wins</Text>
            {wonTickets.map((t) => (
              <View key={t.id} style={styles.winRow}>
                <View style={styles.winRowLeft}>
                  <View style={styles.winIconCircle}>
                    <Trophy size={16} color={color.success} />
                  </View>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.winRowTitle} numberOfLines={1}>Winning ticket{t.winTier ? ` · Tier ${t.winTier}` : ''}</Text>
                    <Text style={styles.winRowSubtitle} numberOfLines={1}>
                      {t.drawTime ? formatDate(t.drawTime) : '—'}{t.numTickets > 1 ? ` · from batch of ${t.numTickets}` : ''}
                    </Text>
                  </View>
                </View>
                <Text style={styles.winRowAmount}>{t.isFreeTicket ? 'Free ticket' : `+${fmt(t.winAmountUsdc ?? 0)}`}</Text>
              </View>
            ))}
          </View>

          {!isFreeTicket && (
            <View style={styles.shieldNoteCard}>
              <ShieldCheck size={16} color={color.success} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.shieldNoteTitle}>{isBatch ? 'All your wins arrive as one private transfer' : 'Arrives privately in your Loofta balance'}</Text>
                <Text style={styles.shieldNoteSubtitle}>No on-chain link between your winnings and your wallet</Text>
              </View>
            </View>
          )}
        </LinearGradient>

        {playAgainError && <Text style={styles.error}>{playAgainError}</Text>}

        {isFreeTicket ? (
          /* Free ticket — replay it into the next draw (rounded up to a whole ticket). No withdraw. */
          <>
            <PrimaryButton disabled={playingAgain} onPress={handlePlayAgain}>
              {playingAgain ? (
                <ActivityIndicator color={color.fg} />
              ) : (
                <Text style={styles.primaryButtonLabel}>
                  ⚡ Play again — {playAgainTicketCount} ticket{playAgainTicketCount === 1 ? '' : 's'}, free
                </Text>
              )}
            </PrimaryButton>
            <Text style={styles.bestValueHint}>Your win goes straight into the next draw — no fees.</Text>
          </>
        ) : preferWithdraw ? (
          /* Win ≥ $5: withdrawing is the featured CTA — a win this size shouldn't default to
             nudging the user straight back into another draw. Play again stays one tap away. */
          <>
            {redeemError && <Text style={styles.error}>{redeemError}</Text>}
            <RedeemGradientButton disabled={redeeming || feeLoading || feeUnavailable} onPress={handleRedeem}>
              {redeeming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.redeemGradientButtonLabel}>
                  {feeUnavailable ? 'Fee unavailable — try again above' : feeLoading ? 'Getting real fee quote…' : `Withdraw ~${fmt(receiveUsdc ?? totalAmount)} privately`}
                </Text>
              )}
            </RedeemGradientButton>
            <TouchableOpacity disabled={playingAgain} onPress={handlePlayAgain}>
              <Text style={styles.withdrawInstead}>
                {playingAgain ? 'Playing again…' : `or play again — ${playAgainTicketCount} ticket${playAgainTicketCount === 1 ? '' : 's'} instead, free`}
              </Text>
            </TouchableOpacity>
          </>
        ) : canPlayAgain ? (
          /* Cash win (< $5): play again is the featured, rounded-up, fee-free deal; withdraw is
             de-emphasised behind a confirmation showing the real net. */
          <>
            <PrimaryButton disabled={playingAgain} onPress={handlePlayAgain}>
              {playingAgain ? (
                <ActivityIndicator color={color.fg} />
              ) : (
                <Text style={styles.primaryButtonLabel}>
                  ⚡ Play again — {playAgainTicketCount} ticket{playAgainTicketCount === 1 ? '' : 's'}
                </Text>
              )}
            </PrimaryButton>
            <Text style={styles.bestValueHint}>
              Best value — we round you up to {playAgainTicketCount} whole ticket{playAgainTicketCount === 1 ? '' : 's'}, no fees
            </Text>
            {!confirmingRedeem ? (
              <TouchableOpacity
                disabled={playingAgain || feeLoading || feeUnavailable}
                onPress={() => setConfirmingRedeem(true)}
              >
                <Text style={styles.withdrawInstead}>
                  {feeUnavailable ? 'Fee unavailable, retry' : feeLoading ? 'Getting fee quote…' : `or withdraw ~${fmt(receiveUsdc ?? totalAmount)} instead`}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.confirmCard}>
                <Text style={styles.playAgainHint}>
                  You&apos;ll receive an estimated {fmt(receiveUsdc ?? totalAmount)} after fees (confirmed once claimed
                  on-chain, may come in slightly lower) — playing again gets you {playAgainTicketCount} full new
                  ticket{playAgainTicketCount === 1 ? '' : 's'} instead, free.
                </Text>
                {redeemError && <Text style={styles.error}>{redeemError}</Text>}
                <View style={styles.confirmActions}>
                  <View style={styles.confirmActionFlex}>
                    <GhostButton label="Cancel" disabled={redeeming} onPress={() => setConfirmingRedeem(false)} />
                  </View>
                  <View style={styles.confirmActionFlex}>
                    <PrimaryButton disabled={redeeming} onPress={handleRedeem}>
                      {redeeming ? (
                        <ActivityIndicator color={color.fg} />
                      ) : (
                        <>
                          <Download size={16} color={color.fg} />
                          <Text style={styles.primaryButtonLabel}>Confirm redeem</Text>
                        </>
                      )}
                    </PrimaryButton>
                  </View>
                </View>
              </View>
            )}
          </>
        ) : (
          /* Edge: a win too small to buy even one replay ticket (< $1) — withdrawal is the only path.
             Deliberately emerald/teal gradient (not brand orange) — matches desktop, distinguishing
             "money coming back" from a purchase CTA. */
          <>
            {redeemError && <Text style={styles.error}>{redeemError}</Text>}
            <RedeemGradientButton disabled={redeeming || feeLoading || feeUnavailable} onPress={handleRedeem}>
              {redeeming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.redeemGradientButtonLabel}>
                  {feeUnavailable ? 'Fee unavailable — try again above' : feeLoading ? 'Getting real fee quote…' : `Redeem ~${fmt(receiveUsdc ?? totalAmount)} privately`}
                </Text>
              )}
            </RedeemGradientButton>
            {feeUnavailable && (
              <TouchableOpacity onPress={() => setFeeUnavailable(false)}>
                <Text style={styles.retryText}>Retry fee estimate</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <Text style={styles.privacyNote}>Payouts are shielded — only you can see the amount and destination.</Text>

        {earlierSection}
      </ScrollView>
      {devPanel}
    </View>
  );
}

export default function RedeemScreen() {
  return (
    <View style={styles.container}>
      <AuthGate>
        <RedeemInner />
      </AuthGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bgInk },
  screen: { padding: space[5], paddingBottom: space[8], gap: space[4], flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgInk, padding: space[6], gap: 10 },

  sectionTitle: { color: color.fg, fontSize: 22, fontFamily: FONT_TITLE_SEMIBOLD },

  iconCircle: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconCircleMuted: { backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },

  // Hero win card — mirrors desktop's emerald gradient card exactly
  heroCard: {
    alignItems: 'center',
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    padding: space[5],
  },
  heroEmoji: { fontSize: 48 },
  heroEyebrow: { color: color.success, fontFamily: FONT_BODY_BOLD, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', marginTop: 4 },
  heroAmount: { fontSize: 40, fontFamily: FONT_TITLE, fontVariant: ['tabular-nums'] },
  heroSubtitle: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY, marginTop: 2 },

  winsList: { width: '100%', gap: space[2], marginTop: space[3] },
  winsLabel: { color: color.fg2, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  winRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingHorizontal: space[3] + 1,
    paddingVertical: space[3],
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    backgroundColor: 'rgba(16,185,129,0.07)',
  },
  winRowLeft: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexShrink: 1 },
  winIconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', alignItems: 'center', justifyContent: 'center' },
  winRowTitle: { color: color.fg, fontFamily: FONT_BODY_MEDIUM, fontSize: 15 },
  winRowSubtitle: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 13, marginTop: 2 },
  winRowAmount: { color: color.success, fontFamily: FONT_BODY_BOLD, fontSize: 17, fontVariant: ['tabular-nums'] },

  shieldNoteCard: {
    flexDirection: 'row',
    gap: space[3],
    width: '100%',
    marginTop: space[3],
    padding: space[3] + 1,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: color.borderSoft,
    backgroundColor: color.surface1,
  },
  shieldNoteTitle: { color: '#cbd5e1', fontFamily: FONT_BODY_MEDIUM, fontSize: 15 },
  shieldNoteSubtitle: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 13, marginTop: 2 },

  // Fee breakdown
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
  feeTotalValue: { color: color.success, fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },

  primaryButtonLabel: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  bestValueHint: { color: color.success, fontSize: 13, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center' },
  withdrawInstead: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center', textDecorationLine: 'underline', paddingVertical: space[1] },
  retryText: { color: color.brandOrange, textAlign: 'center', fontSize: 14, fontFamily: FONT_BODY_SEMIBOLD },
  error: { color: color.danger, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },

  redeemGradientButton: { borderRadius: radius.lg, paddingVertical: space[5], alignItems: 'center', justifyContent: 'center' },
  redeemGradientButtonLabel: { color: '#fff', fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },

  privacyNote: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space[8] },
  emptyTitle: { color: color.fg, fontSize: 22, fontFamily: FONT_TITLE_SEMIBOLD },
  emptySubtitle: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY, textAlign: 'center' },

  doneEmoji: { fontSize: 48 },
  progressLabel: { color: color.success, fontSize: 12, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressTitle: { fontSize: 32, fontFamily: FONT_TITLE, fontVariant: ['tabular-nums'] },
  progressSubtitle: { color: '#e2e8f0', fontSize: 16, fontFamily: FONT_BODY_MEDIUM, marginTop: 4 },
  progressHint: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY, textAlign: 'center' },
  leavePageHint: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center' },
  backLink: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY, textDecorationLine: 'underline' },

  // Withdrawal progress tracker
  trackerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: space[2], marginTop: space[2] },
  trackerStepWrap: { flexDirection: 'row', alignItems: 'flex-start' },
  trackerStepCol: { alignItems: 'center', gap: 6, width: 92 },
  trackerDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  trackerDotDone: { backgroundColor: color.success, borderColor: '#6ee7b7' },
  trackerDotActive: { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: 'rgba(52,211,153,0.6)' },
  trackerDotPending: { backgroundColor: color.surface3, borderColor: color.borderSoft },
  trackerPulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#34d399' },
  trackerPendingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)' },
  trackerLabel: { color: '#6ee7b7', fontSize: 13, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center' },
  trackerLabelPending: { color: color.fg3 },
  trackerLine: { height: 1, width: 24, backgroundColor: color.borderSoft, marginTop: 15 },
  trackerLineDone: { backgroundColor: 'rgba(52,211,153,0.6)' },

  confirmCard: {
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: color.surface1,
    padding: space[4] - 2,
    gap: space[3],
  },
  playAgainHint: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY },
  confirmActions: { flexDirection: 'row', gap: space[3] },
  confirmActionFlex: { flex: 1 },

  earlierSection: { gap: space[3], marginTop: space[2] },
  earlierTitle: { color: color.fg3, fontSize: 13, fontFamily: FONT_BODY_BOLD, letterSpacing: 1, textTransform: 'uppercase' },
  earlierList: {
    borderWidth: 1,
    borderColor: color.borderSofter,
    borderRadius: radius.md + 2,
    overflow: 'hidden',
  },
  earlierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.borderSofter,
    backgroundColor: color.surface1,
  },
  earlierRowLast: { borderBottomWidth: 0 },
  earlierRowText: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY, flexShrink: 1 },
  earlierRowAmount: { color: color.success, fontSize: 13, fontFamily: FONT_BODY_SEMIBOLD },

  // Dev preview panel
  devPanel: {
    borderTopWidth: 1,
    borderTopColor: color.borderSofter,
    backgroundColor: color.bgInkSoft,
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    gap: space[2],
  },
  devPanelTitle: { color: color.fg4, fontFamily: FONT_BODY_BOLD, fontSize: 10, letterSpacing: 1.5 },
  devPanelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  devPanelChip: { paddingHorizontal: space[2] + 2, paddingVertical: 6, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: color.borderSoft, backgroundColor: color.surface1 },
  devPanelChipActive: { borderColor: color.brandOrange, backgroundColor: 'rgba(255,74,38,0.16)' },
  devPanelChipText: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 11 },
  devPanelChipTextActive: { color: color.brandOrange },
});
