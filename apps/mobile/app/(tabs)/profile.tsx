import { usePrivy } from '@privy-io/expo';
import * as Clipboard from 'expo-clipboard';
import { Check, ChevronDown, ChevronUp, Copy, LifeBuoy, Ticket, Wallet } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSeekerLogin, logoutSeeker } from '../../lib/auth/useSeekerLogin';
import { ensureProfile, getWalletBalances } from '../../lib/api/users';
import { SolIcon } from '../../components/TokenIcons';
import { Wordmark } from '../../components/Wordmark';
import { WalletConnectSheet } from '../../components/WalletConnectSheet';
import { PoweredByFooter } from '../../components/PoweredByFooter';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GradientText } from '../../components/ui/GradientText';
import { ShieldNote } from '../../components/ui/ShieldNote';
import { Card } from '../../components/ui/Card';
import { GhostButton } from '../../components/ui/GhostButton';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_TITLE, FONT_TITLE_SEMIBOLD } from '../../lib/fonts';

const SUPPORT_URL = 'https://t.me/looftapay';

// Snapshot of Megapot's published tiers (docs.megapot.io/learn/prize-structure, taken
// 2026-07-12 against a ~$1.1M pool), net of the ~10% on-chain referral cut Loofta actually
// takes on every cash win (mirrors the web prize table and DEFAULT_REFERRAL_WIN_SHARE_FACTOR
// in megapot.service.ts). Megapot's pool grows daily, so these drift out of date — re-pull
// from the docs page periodically. Wins below the withdrawal floor pay out as a "Free ticket"
// (play again, no fees).
const PRIZE_TIERS: { match: string; prize: string }[] = [
  { match: '5 + bonus', prize: '$183,918.03' },
  { match: '5 numbers', prize: '$1,858.64' },
  { match: '4 + bonus', prize: '$179.24' },
  { match: '4 numbers', prize: '$20.71' },
  { match: '3 + bonus', prize: '$8.33' },
  { match: '2 + bonus', prize: '$4.77' },
  { match: '3 numbers', prize: '$4.19' },
  { match: '1 + bonus', prize: '$2.66' },
  { match: '2 numbers', prize: 'Free ticket' },
  { match: 'Bonus only', prize: 'Free ticket' },
];

const HOW_TO_PLAY: { title: string; body: string }[] = [
  { title: '1. Pick your numbers', body: 'Choose 5 numbers (1–30) plus a bonus (1–12), or let us pick them randomly.' },
  { title: '2. Pay privately', body: 'Tickets are $1 each, paid from your Seeker wallet and shielded via MagicBlock. Buy as many as you like.' },
  { title: '3. Daily draw', body: 'A draw happens every day. The more of your numbers match, the bigger the prize.' },
  { title: '4. Collect your win', body: 'Small wins come back as a free ticket to play again (no fees). Bigger wins can be redeemed privately to your wallet.' },
];

function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {open ? <ChevronUp size={18} color={color.fg3} /> : <ChevronDown size={18} color={color.fg3} />}
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </Card>
  );
}

function truncateAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Trims trailing zeros; avoids NaN/scientific notation on a bad balance fetch. */
function formatToken(n: number, maxDecimals: number): string {
  if (!Number.isFinite(n)) return '--';
  if (n === 0) return '0';
  return n.toFixed(maxDecimals).replace(/\.?0+$/, '') || '0';
}

function findWalletAddress(accounts: any[]): string | null {
  return accounts.find(a => a.type === 'wallet' && a.chain_type === 'solana')?.address ?? null;
}

export default function ProfileScreen() {
  const { user, isReady, logout } = usePrivy();
  const { loginWithSeeker, status, error } = useSeekerLogin();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.brandOrange} />
      </View>
    );
  }

  if (user) {
    return <LoggedInProfile user={user} onLogout={() => logoutSeeker(logout)} />;
  }

  const busy = status === 'connecting' || status === 'verifying';
  const statusLabel = status === 'connecting' ? 'Connecting to Seed Vault…' : status === 'verifying' ? 'Verifying…' : 'Connect';

  return (
    <View style={styles.connectScreen}>
      <View style={styles.connectIconTile}>
        <Ticket size={28} color={color.fg} />
      </View>
      <Wordmark width={140} />
      <Text style={styles.eyebrow}>Private lottery · Solana</Text>
      <Text style={styles.headline}>Play private.</Text>
      <GradientText style={styles.headline}>Win private.</GradientText>
      <Text style={styles.subtitle}>
        Buy tickets directly from your Seeker wallet — every entry and every payout is shielded on-chain via
        MagicBlock.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.connectFooter}>
        <PrimaryButton onPress={() => setSheetOpen(true)} disabled={busy}>
          <Wallet size={18} color={color.fg} />
          <Text style={styles.connectButtonText}>{busy ? statusLabel : 'Connect Seeker wallet'}</Text>
        </PrimaryButton>
        <ShieldNote text="No custody · no embedded wallet · you hold the keys" />
      </View>

      <WalletConnectSheet
        visible={sheetOpen}
        busy={busy}
        statusLabel={statusLabel}
        onCancel={() => setSheetOpen(false)}
        onConnect={() => {
          if (busy) return;
          loginWithSeeker();
        }}
      />
    </View>
  );
}

function LoggedInProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
  const { getAccessToken } = usePrivy();
  const accounts = user.linked_accounts ?? [];
  const walletAddress = findWalletAddress(accounts);

  const [skrDomain, setSkrDomain] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        // ensureProfile bootstraps the app_users row (idempotent, harmless if useSeekerLogin
        // already did it) — its username is no longer shown here, the .skr domain replaces it.
        const [, balances] = await Promise.all([
          ensureProfile(accessToken),
          getWalletBalances(accessToken),
        ]);
        if (cancelled) return;
        setSkrDomain(balances.skrDomain);
        setSolBalance(balances.solBalance);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load wallet info');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const identity = skrDomain ?? (walletAddress ? truncateAddress(walletAddress) : 'Not connected');
  const copyValue = skrDomain ?? walletAddress;

  const handleCopy = async () => {
    if (!copyValue) return;
    await Clipboard.setStringAsync(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
      <Text style={styles.title}>Settings</Text>

      <Card style={styles.identityCard}>
        <Text style={styles.label}>Seeker ID</Text>
        <View style={styles.identityRow}>
          <Text style={styles.value}>{identity}</Text>
          {copyValue && (
            <TouchableOpacity style={styles.copyButton} onPress={handleCopy} activeOpacity={0.7}>
              {copied ? <Check size={16} color={color.success} /> : <Copy size={16} color={color.fg3} />}
            </TouchableOpacity>
          )}
        </View>
        {copied && <Text style={styles.copiedHint}>Copied</Text>}
      </Card>

      {error && <Text style={styles.error}>{error}</Text>}

      <Card style={styles.walletCard}>
        <View style={styles.walletHeaderRow}>
          <View style={styles.walletHeaderLeft}>
            <View style={styles.statusDot} />
            <Text style={styles.walletHeaderText}>Seeker wallet</Text>
          </View>
          <GhostButton label="Disconnect" tone="danger" onPress={onLogout} />
        </View>
        <View style={styles.walletBalanceRow}>
          <SolIcon size={16} />
          <Text style={styles.walletAddress}>{walletAddress ? truncateAddress(walletAddress) : '--'}</Text>
          <Text style={styles.walletBalance}>{solBalance !== null ? `${formatToken(solBalance, 4)} SOL` : '--'}</Text>
        </View>
      </Card>

      <CollapsibleSection title="How to play">
        {HOW_TO_PLAY.map((s) => (
          <View key={s.title} style={styles.howRow}>
            <Text style={styles.howTitle}>{s.title}</Text>
            <Text style={styles.howBody}>{s.body}</Text>
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Prize tiers">
        {PRIZE_TIERS.map((t) => {
          const free = t.prize === 'Free ticket';
          return (
            <View key={t.match} style={styles.tierRow}>
              <Text style={styles.tierMatch}>{t.match}</Text>
              <Text style={[styles.tierPrize, free && styles.tierPrizeFree]}>{t.prize}</Text>
            </View>
          );
        })}
        <Text style={styles.tierNote}>All prize tiers are automatically paid out from the total prize pool every day.</Text>
      </CollapsibleSection>

      <TouchableOpacity style={styles.supportRow} onPress={() => Linking.openURL(SUPPORT_URL)} activeOpacity={0.7}>
        <LifeBuoy size={18} color={color.fg2} />
        <Text style={styles.supportText}>Contact support</Text>
      </TouchableOpacity>

      <PoweredByFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bgInk },
  containerContent: { padding: space[5], gap: space[4] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f12', padding: 20 },
  title: { color: color.fg, fontSize: 24, fontFamily: FONT_TITLE, marginTop: 12 },
  subtitle: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // Connect screen
  connectScreen: { flex: 1, backgroundColor: color.bgInk, alignItems: 'center', justifyContent: 'center', padding: space[6], gap: space[2] },
  connectIconTile: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: color.brandOrange,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[4],
  },
  eyebrow: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginTop: space[5], marginBottom: space[2] },
  headline: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 32, textAlign: 'center' },
  connectFooter: { width: '100%', maxWidth: 360, marginTop: space[8], gap: space[4], alignItems: 'center' },
  connectButtonText: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 16 },
  buttonOutline: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  buttonOutlineText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: color.danger, fontFamily: FONT_BODY, fontSize: 13, textAlign: 'center' },

  // Identity card
  identityCard: { gap: space[2] },
  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  label: { color: color.fg3, fontFamily: FONT_BODY_MEDIUM, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  value: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16, flexShrink: 1 },
  copyButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface3,
  },
  copiedHint: { color: color.success, fontFamily: FONT_BODY_MEDIUM, fontSize: 12 },

  // Connected wallet card
  walletCard: { gap: space[3] },
  walletHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.success },
  walletHeaderText: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  walletBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.borderSofter,
  },
  walletAddress: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 13, flex: 1 },
  walletBalance: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13 },

  // How to play / Prize tiers collapsibles
  section: { padding: 0, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space[4] },
  sectionTitle: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },
  sectionBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: color.borderSofter, paddingTop: space[3] },
  howRow: { gap: 2 },
  howTitle: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  howBody: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 13, lineHeight: 19 },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierMatch: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 14 },
  tierPrize: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  tierPrizeFree: { color: color.brandOrange },
  tierNote: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 12, lineHeight: 17, marginTop: space[1] },

  // Contact support
  supportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], paddingVertical: space[3] },
  supportText: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 14 },
});
