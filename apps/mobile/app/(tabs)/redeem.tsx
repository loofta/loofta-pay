import { usePrivy } from '@privy-io/expo';
import { Download, PartyPopper, ShieldCheck, Sparkles, Ticket, Trophy } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../../components/AuthGate';
import { Card } from '../../components/ui/Card';
import { GhostButton } from '../../components/ui/GhostButton';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ShieldNote } from '../../components/ui/ShieldNote';
import { getBridgeFee, getDashboard, playAgain, withdrawBatch, type LotteryTicketSummary, type LotteryWithdrawalSummary } from '../../lib/api/lottery';
import { fmt, DEFAULT_WITHDRAW_MIN_USDC, isFreeTicketAmount } from '../../lib/lottery/fees';
import { connectSeekerWallet } from '../../lib/wallet/mwa';
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

  const totalAmount = wonTickets.reduce((sum, t) => sum + (t.winAmountUsdc ?? 0), 0);
  // Play-again ticket count, matching the backend playAgain rule: a cash win (≥ withdrawMin) is
  // ROUNDED UP (backend funds the <$1 gap from the fee wallet); a free-ticket win (< withdrawMin)
  // is floored (backend sweeps the small change to us — no round-up when there's no withdraw).
  const playAgainTicketCount = wonTickets.reduce((sum, t) => {
    const n = t.winAmountUsdc ?? 0;
    return sum + (n >= withdrawMin ? Math.max(1, Math.ceil(n)) : Math.floor(n));
  }, 0);
  const canPlayAgain = wonTickets.some((t) => (t.winAmountUsdc ?? 0) > 0);
  const isFreeTicket = isFreeTicketAmount(totalAmount, withdrawMin) && canPlayAgain;
  const heroRoundId = wonTickets[0]?.roundId ?? null;

  useEffect(() => {
    if (!totalAmount) return;
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
  }, [totalAmount, getAccessToken]);

  // Poll withdrawal completion once redeem is submitted.
  useEffect(() => {
    if (!withdrawalIds.length || arrived || transferFailed) return;
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
  }, [withdrawalIds, arrived, transferFailed, getAccessToken]);

  async function handleRedeem() {
    if (!wonTickets.length) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      const { base58Address } = await connectSeekerWallet();
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.brandOrange} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  // ── Redeem in flight / done ──────────────────────────────────────────────
  if (withdrawalIds.length) {
    return (
      <View style={styles.center}>
        <View style={[styles.iconCircle, arrived ? styles.iconCircleSuccess : styles.iconCircleOrange]}>
          {arrived ? <PartyPopper size={26} color={color.fg} /> : <ShieldCheck size={26} color={color.fg} />}
        </View>
        <Text style={styles.progressLabel}>{arrived ? 'Withdrawal complete' : 'Withdrawal on its way'}</Text>
        <Text style={styles.progressTitle}>{fmt(doneAmount)}</Text>
        <Text style={styles.progressHint}>
          {arrived
            ? 'Delivered privately to your wallet — no on-chain link back to you.'
            : 'Arrives in a few minutes. No on-chain link back to you.'}
        </Text>
        {transferFailed && (
          <Text style={styles.error}>Something went wrong in transit — your funds are safe. Check History or contact support.</Text>
        )}
      </View>
    );
  }

  // ── Played again ────────────────────────────────────────────────────────
  if (playAgainDone) {
    return (
      <View style={styles.center}>
        <View style={[styles.iconCircle, styles.iconCircleOrange]}>
          <Ticket size={26} color={color.fg} />
        </View>
        <Text style={styles.progressLabel}>Played again</Text>
        <Text style={styles.progressTitle}>
          {playAgainDone.numTickets} new ticket{playAgainDone.numTickets === 1 ? '' : 's'}
        </Text>
        <Text style={styles.progressHint}>Your winnings went straight back into the next draw — no fees.</Text>
        <GhostButton label="Back" onPress={() => setPlayAgainDone(null)} />
      </View>
    );
  }

  // ── No winnings ──────────────────────────────────────────────────────────
  if (!wonTickets.length) {
    return (
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
    );
  }

  // ── Ready to redeem ──────────────────────────────────────────────────────
  return (
    <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Redeem</Text>

      <Card tint="success" style={styles.heroCard}>
        <View style={[styles.iconCircle, styles.iconCircleOrange]}>
          <Trophy size={24} color={color.fg} />
        </View>
        <Text style={styles.heroLabel}>You won{heroRoundId ? ` · Draw #${heroRoundId}` : ''}</Text>
        <Text style={styles.heroAmount}>{fmt(totalAmount)}</Text>
        <ShieldNote text="Shielded — only you can see this" />
      </Card>

      {!isFreeTicket && (
        <View style={styles.feeCard}>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Gross winnings</Text>
            <Text style={styles.feeValue}>{fmt(totalAmount)}</Text>
          </View>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Bridge fee</Text>
            <Text style={styles.feeValue}>{feeLoading ? '…' : feeUnavailable ? 'unavailable' : fmt(feeUsd ?? 0)}</Text>
          </View>
          <View style={[styles.feeRow, styles.feeTotalRow]}>
            <Text style={styles.feeTotalLabel}>You&apos;ll receive</Text>
            <Text style={styles.feeTotalValue}>{feeLoading ? '…' : `~${fmt(receiveUsdc ?? totalAmount)}`}</Text>
          </View>
        </View>
      )}

      {playAgainError && <Text style={styles.error}>{playAgainError}</Text>}

      {isFreeTicket ? (
        /* Free ticket — replay it into the next draw (rounded up to a whole ticket). No withdraw. */
        <>
          <PrimaryButton disabled={playingAgain} onPress={handlePlayAgain}>
            {playingAgain ? (
              <ActivityIndicator color={color.fg} />
            ) : (
              <>
                <Sparkles size={18} color={color.fg} />
                <Text style={styles.primaryButtonLabel}>
                  Play again — {playAgainTicketCount} ticket{playAgainTicketCount === 1 ? '' : 's'}, free
                </Text>
              </>
            )}
          </PrimaryButton>
          <Text style={styles.bestValueHint}>Your win goes straight into the next draw — no fees.</Text>
        </>
      ) : canPlayAgain ? (
        /* Cash win: play again is the featured, rounded-up, fee-free deal; withdraw is de-emphasised
           behind a confirmation showing the real net. */
        <>
          <PrimaryButton disabled={playingAgain} onPress={handlePlayAgain}>
            {playingAgain ? (
              <ActivityIndicator color={color.fg} />
            ) : (
              <>
                <Sparkles size={18} color={color.fg} />
                <Text style={styles.primaryButtonLabel}>
                  Play again — {playAgainTicketCount} ticket{playAgainTicketCount === 1 ? '' : 's'}
                </Text>
              </>
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
        /* Edge: a win too small to buy even one replay ticket (< $1) — withdrawal is the only path. */
        <>
          {redeemError && <Text style={styles.error}>{redeemError}</Text>}
          <PrimaryButton disabled={redeeming || feeLoading || feeUnavailable} onPress={handleRedeem}>
            {redeeming ? (
              <ActivityIndicator color={color.fg} />
            ) : (
              <>
                <Download size={18} color={color.fg} />
                <Text style={styles.primaryButtonLabel}>Redeem to Seeker wallet</Text>
              </>
            )}
          </PrimaryButton>
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

  // Icon circles (progress states + hero + empty)
  iconCircle: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconCircleOrange: { backgroundColor: color.brandOrange },
  iconCircleSuccess: { backgroundColor: color.success },
  iconCircleMuted: { backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },

  // Hero win card
  heroCard: { alignItems: 'center', gap: space[2] },
  heroLabel: { color: color.fg2, fontSize: 14, fontFamily: FONT_BODY_MEDIUM, marginTop: space[1] },
  heroAmount: {
    color: color.fg,
    fontSize: 40,
    fontFamily: FONT_TITLE,
    fontVariant: ['tabular-nums'],
    marginBottom: space[1],
  },

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
  withdrawInstead: { color: color.fg3, fontSize: 13, fontFamily: FONT_BODY, textAlign: 'center', textDecorationLine: 'underline' },
  retryText: { color: color.brandOrange, textAlign: 'center', fontSize: 14, fontFamily: FONT_BODY_SEMIBOLD },
  error: { color: color.danger, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },

  privacyNote: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space[8] },
  emptyTitle: { color: color.fg, fontSize: 22, fontFamily: FONT_TITLE_SEMIBOLD },
  emptySubtitle: { color: color.fg2, fontSize: 15, fontFamily: FONT_BODY, textAlign: 'center' },

  progressLabel: { color: color.success, fontSize: 12, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressTitle: { color: color.fg, fontSize: 32, fontFamily: FONT_TITLE },
  progressHint: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY, textAlign: 'center' },

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
});
