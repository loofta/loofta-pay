import { usePrivy } from '@privy-io/expo';
import { Ticket, Trophy } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../../components/AuthGate';
import { Pill } from '../../components/ui/Pill';
import { StatTile } from '../../components/ui/StatTile';
import { TicketRow } from '../../components/ui/TicketRow';
import { TicketNumberRow } from '../../components/ui/TicketNumberRow';
import { TicketNumbersModal } from '../../components/TicketNumbersModal';
import type { StatusChipTone } from '../../components/ui/StatusChip';
import {
  getDashboard,
  getHistory,
  type LotteryDashboard,
  type LotteryTicketSummary,
  type TicketStatus,
} from '../../lib/api/lottery';
import { DEFAULT_WITHDRAW_MIN_USDC, fmt, isFreeTicketAmount } from '../../lib/lottery/fees';
import { color, space } from '../../lib/theme';
import { FONT_BODY, FONT_BODY_MEDIUM, FONT_TITLE } from '../../lib/fonts';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<TicketStatus, string> = {
  pending_send: 'Pending',
  sent: 'Sent',
  bridging: 'Receiving',
  buying: 'Buying',
  active: 'Active',
  won: 'Won',
  lost: 'Lost',
  failed: 'Failed',
  withdrawn: 'Withdrawn',
};

/** Still in flight — ticket hasn't resolved to a win/loss yet. Shown amber ("in this draw"). */
const PENDING_STATUSES: ReadonlySet<TicketStatus> = new Set(['pending_send', 'sent', 'bridging', 'buying', 'active']);

/**
 * A ticket counts as a "win" (for both the status chip tone and the Won filter pill) when it's
 * resolved won/withdrawn AND has a strictly positive payout — mirrors the previous file's
 * `isWinLike` check, just narrowed to exclude the (unlikely) zero/null-amount edge case so it
 * doesn't get bucketed as a win with nothing to show.
 */
function winAmountOf(ticket: LotteryTicketSummary): number | null {
  const isWinLike = ticket.status === 'won' || ticket.status === 'withdrawn';
  if (!isWinLike) return null;
  const amt = ticket.winAmountUsdc;
  if (amt == null || amt <= 0) return null;
  return amt;
}

function statusTone(ticket: LotteryTicketSummary, isWin: boolean): StatusChipTone {
  if (ticket.status === 'failed') return 'danger';
  if (PENDING_STATUSES.has(ticket.status)) return 'amber';
  if (isWin) return 'success';
  return 'neutral'; // lost, or a resolved won/withdrawn ticket with no positive payout
}

// ── Filter pills ─────────────────────────────────────────────────────────────
// Purely client-side over the already-fetched ticket list — no new backend behavior. "All" shows
// everything; "Won" = resolved with a positive payout (won, or withdrawn after winning); "Lost" =
// status 'lost'. In-flight/failed tickets only ever show under "All", matching the fact that they
// haven't (or didn't) resolve into either bucket.
type FilterKey = 'all' | 'won' | 'lost';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

function matchesFilter(ticket: LotteryTicketSummary, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'won') return winAmountOf(ticket) != null;
  return ticket.status === 'lost';
}

const MAX_NUMBER_ROWS_SHOWN = 3;

function HistoryTicketRow({ ticket, withdrawMinUsdc }: { ticket: LotteryTicketSummary; withdrawMinUsdc: number }) {
  const [showAll, setShowAll] = useState(false);
  const winAmount = winAmountOf(ticket);
  const showFree = winAmount != null && isFreeTicketAmount(winAmount, withdrawMinUsdc);

  const baseTitle = `${ticket.numTickets} ticket${ticket.numTickets === 1 ? '' : 's'}`;
  const title = ticket.roundId ? `${baseTitle} · Draw #${ticket.roundId}` : baseTitle;
  const dateLabel = new Date(ticket.createdAt).toLocaleDateString();
  const subtitle = ticket.isGift ? `${dateLabel} · Gifted` : dateLabel;

  const amountLabel = winAmount != null ? (showFree ? 'Free' : `+${fmt(winAmount)}`) : `−${fmt(ticket.costUsdc)}`;

  const numbers = ticket.ticketNumbers ?? [];
  const shownNumbers = numbers.slice(0, MAX_NUMBER_ROWS_SHOWN);
  const hiddenCount = numbers.length - shownNumbers.length;

  return (
    <View>
      <TicketRow
        title={title}
        subtitle={subtitle}
        statusLabel={STATUS_LABEL[ticket.status]}
        statusTone={statusTone(ticket, winAmount != null)}
        amountLabel={amountLabel}
      />
      {shownNumbers.length > 0 && (
        <View style={styles.numbersBlock}>
          {shownNumbers.map((n, i) => (
            <TicketNumberRow key={i} main={n.main} bonus={n.bonus} />
          ))}
          {hiddenCount > 0 && (
            <TouchableOpacity onPress={() => setShowAll(true)} activeOpacity={0.7}>
              <Text style={styles.numbersMore}>+{hiddenCount} more ticket{hiddenCount === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <TicketNumbersModal visible={showAll} onClose={() => setShowAll(false)} title={title} numbers={numbers} />
    </View>
  );
}

function HistoryList() {
  const { getAccessToken } = usePrivy();
  const [tickets, setTickets] = useState<LotteryTicketSummary[]>([]);
  const [dashboard, setDashboard] = useState<LotteryDashboard | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      const [{ tickets: fetchedTickets }, dash] = await Promise.all([
        getHistory(0, PAGE_SIZE, accessToken),
        getDashboard(accessToken),
      ]);
      // getHistory only returns resolved tickets (won/lost/failed/withdrawn) — a ticket that's
      // just been bought and is still 'active' (awaiting the draw) or mid-purchase
      // (sent/bridging/buying) never appears there, only in the dashboard's activeTickets. Merge
      // both so a fresh purchase shows up here immediately instead of only after it resolves.
      // Exclude 'pending_send' specifically: no payment has actually been sent yet at that point
      // (it's the split-second before/during the wallet prompt), so showing it here would surface
      // abandoned/cancelled purchase attempts as if they were real tickets — the Buy screen's own
      // "Hang tight" flow already covers the brief legitimate window for a live attempt.
      const active = dash.activeTickets.filter((t) => t.status !== 'pending_send');
      setTickets([...active, ...fetchedTickets]);
      setDashboard(dash);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load history');
    }
  }, [getAccessToken]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // "Check results when the user opens the app" — draw results resolve server-side on a cron
  // independent of any client request; refetching on every foreground transition (not just once
  // on mount) is what keeps this screen from showing stale win/loss state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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

  const withdrawMinUsdc = dashboard?.withdrawMinUsdc ?? DEFAULT_WITHDRAW_MIN_USDC;
  const filteredTickets = tickets.filter((t) => matchesFilter(t, filter));

  return (
    <FlatList
      data={filteredTickets}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => <HistoryTicketRow ticket={item} withdrawMinUsdc={withdrawMinUsdc} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.brandOrange} />}
      ListHeaderComponent={
        <View style={styles.header}>
          {dashboard && (
            <View style={styles.statsRow}>
              <StatTile icon={<Ticket size={18} color={color.fg2} />} label="Spent" value={fmt(dashboard.stats.totalSpent)} />
              <StatTile
                icon={<Trophy size={18} color={color.success} />}
                label="Won"
                value={fmt(dashboard.stats.totalWon)}
                tone="success"
              />
            </View>
          )}
          <View style={styles.filterRow}>
            {FILTERS.map((f) => (
              <Pill key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>{tickets.length === 0 ? 'No tickets yet.' : `No ${filter} tickets.`}</Text>
      }
    />
  );
}

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>History</Text>
      <AuthGate>
        <HistoryList />
      </AuthGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bgInk },
  title: { color: color.fg, fontSize: 24, fontFamily: FONT_TITLE, padding: space[5], paddingBottom: space[2] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: space[5], paddingBottom: space[5], flexGrow: 1 },
  header: { gap: space[4], paddingBottom: space[4] },
  statsRow: { flexDirection: 'row', gap: space[3] },
  filterRow: { flexDirection: 'row', gap: space[2] },
  separator: { height: 1, backgroundColor: color.borderSofter },
  empty: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 17, textAlign: 'center', marginTop: space[8] },
  error: { color: color.danger, fontFamily: FONT_BODY, fontSize: 14 },

  // Per-ticket numbers, shown under each row
  numbersBlock: { gap: space[2], paddingBottom: space[3] },
  numbersMore: { color: color.brandOrange, fontFamily: FONT_BODY_MEDIUM, fontSize: 12 },
});
