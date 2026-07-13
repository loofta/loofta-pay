import { usePrivy } from '@privy-io/expo';
import * as Clipboard from 'expo-clipboard';
import { Check, ChevronRight, Copy, Globe, LifeBuoy, Wallet } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSeekerLogin, logoutSeeker } from '../../lib/auth/useSeekerLogin';
import { ensureProfile } from '../../lib/api/users';
import { getCachedSeekerIdentity, updateCachedSkrDomain, updateCachedUsername } from '../../lib/storage/seekerIdentity';
import { useBalances } from '../../lib/wallet/BalanceProvider';
import { useTranslation } from '../../lib/i18n/LanguageProvider';
import { LANGUAGES } from '../../lib/i18n/locales';
import { SolIcon } from '../../components/TokenIcons';
import { Wordmark } from '../../components/Wordmark';
import { WalletConnectSheet } from '../../components/WalletConnectSheet';
import { HowToPlayModal } from '../../components/HowToPlayModal';
import { PrizeTiersModal } from '../../components/PrizeTiersModal';
import { LanguageModal } from '../../components/LanguageModal';
import { PoweredByFooter } from '../../components/PoweredByFooter';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GradientText } from '../../components/ui/GradientText';
import { Card } from '../../components/ui/Card';
import { GhostButton } from '../../components/ui/GhostButton';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_TITLE, FONT_TITLE_SEMIBOLD } from '../../lib/fonts';

const SUPPORT_URL = 'https://t.me/looftapay';

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
  const { t } = useTranslation();

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
  const statusLabel = status === 'connecting' ? t.profileConnectingSeedVault : status === 'verifying' ? t.profileVerifying : t.connect;

  return (
    <View style={styles.connectScreen}>
      <View style={styles.connectContent}>
        <Wordmark width={140} />
        <View style={styles.connectHeadlineGroup}>
          <Text style={styles.headline}>{t.profileHeadline1}</Text>
          <GradientText style={styles.headline}>{t.profileHeadline2}</GradientText>
        </View>
        <Text style={styles.subtitle}>{t.profileSubtitle}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {/* Full-width CTA pinned above the tab bar, like a native app footer button. */}
      <View style={styles.connectFooter}>
        <PrimaryButton onPress={() => setSheetOpen(true)} disabled={busy}>
          <Wallet size={18} color={color.fg} />
          <Text style={styles.connectButtonText}>{busy ? statusLabel : t.profileConnectWallet}</Text>
        </PrimaryButton>
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
  const { t, language } = useTranslation();
  const accounts = user.linked_accounts ?? [];
  const walletAddress = findWalletAddress(accounts);
  // solBalance/skrDomain come from the shared BalanceProvider (same fetch the header chip uses)
  // instead of a separate call here, so a purchase's refreshBalances() updates both at once.
  const { solBalance, skrDomain: liveSkrDomain, balancesLoaded } = useBalances();

  const [cachedIdentity, setCachedIdentity] = useState<{ skrDomain: string | null; username: string | null } | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [prizeTiersOpen, setPrizeTiersOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const currentLanguageLabel = LANGUAGES.find((l) => l.code === language)?.nativeLabel ?? '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Paint the cached Seeker ID immediately (no spinner/"Not connected" flash on every
      // profile visit) — this is normally wallet-sourced (see connectSeekerWallet's `label`,
      // captured at login/buy/redeem time), then refresh username from the network below.
      const cached = await getCachedSeekerIdentity();
      if (cached && !cancelled) setCachedIdentity(cached);
      try {
        const accessToken = await getAccessToken();
        // ensureProfile bootstraps the app_users row (idempotent, harmless if useSeekerLogin
        // already did it); its username is the Seeker ID fallback when there's no .skr domain.
        const profile = await ensureProfile(accessToken);
        if (!cancelled) setUsername(profile.username);
        if (profile.username) void updateCachedUsername(profile.username);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? t.profileCouldNotLoad);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  // The backend's own .skr lookup (an on-chain RPC call) is a secondary source — useful for
  // users who haven't reconnected since the wallet-label cache was added, but it can fail
  // independently of whether a domain is actually claimed (RPC hiccup, dependency bug, etc.), so
  // it's only ever additive: cachedIdentity (wallet-sourced) wins whenever it's already present,
  // and a null/failed result here never overwrites a known-good cached value.
  useEffect(() => {
    if (!balancesLoaded || !liveSkrDomain) return;
    void updateCachedSkrDomain(liveSkrDomain);
    setCachedIdentity((prev) => ({ skrDomain: liveSkrDomain, username: prev?.username ?? null }));
  }, [balancesLoaded, liveSkrDomain]);

  const skrDomain = cachedIdentity?.skrDomain ?? (balancesLoaded ? liveSkrDomain : null);
  const effectiveUsername = username ?? cachedIdentity?.username ?? null;
  const identity = skrDomain ?? effectiveUsername ?? (walletAddress ? truncateAddress(walletAddress) : t.profileNotConnected);
  const copyValue = skrDomain ?? effectiveUsername ?? walletAddress;

  const handleCopy = async () => {
    if (!copyValue) return;
    await Clipboard.setStringAsync(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
        <Text style={styles.title}>{t.settingsTitle}</Text>

        <Card style={styles.identityCard}>
          <Text style={styles.label}>{t.seekerIdLabel}</Text>
          <View style={styles.identityRow}>
            <Text style={styles.value}>{identity}</Text>
            {copyValue && (
              <TouchableOpacity style={styles.copyButton} onPress={handleCopy} activeOpacity={0.7}>
                {copied ? <Check size={16} color={color.success} /> : <Copy size={16} color={color.fg3} />}
              </TouchableOpacity>
            )}
          </View>
          {copied && <Text style={styles.copiedHint}>{t.copiedHint}</Text>}

          <View style={styles.cardDivider} />

          <View style={styles.walletHeaderRow}>
            <View style={styles.walletHeaderLeft}>
              <View style={styles.statusDot} />
              <Text style={styles.walletHeaderText}>{t.seekerWalletLabel}</Text>
            </View>
            <GhostButton label={t.disconnect} tone="danger" onPress={onLogout} />
          </View>
          <View style={styles.walletBalanceRow}>
            <SolIcon size={16} />
            <Text style={styles.walletAddress}>{walletAddress ? truncateAddress(walletAddress) : '--'}</Text>
            <Text style={styles.walletBalance}>{solBalance !== null ? `${formatToken(solBalance, 4)} SOL` : '--'}</Text>
          </View>
        </Card>

        {error && <Text style={styles.error}>{error}</Text>}

        <Card style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setHowToPlayOpen(true)} activeOpacity={0.7}>
            <Text style={styles.sectionTitle}>{t.howToPlayTitle}</Text>
            <ChevronRight size={18} color={color.fg3} />
          </TouchableOpacity>
        </Card>

        <Card style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setPrizeTiersOpen(true)} activeOpacity={0.7}>
            <Text style={styles.sectionTitle}>{t.prizeTiersTitle}</Text>
            <ChevronRight size={18} color={color.fg3} />
          </TouchableOpacity>
        </Card>

        <Card style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setLanguageOpen(true)} activeOpacity={0.7}>
            <View style={styles.languageHeaderLeft}>
              <Globe size={18} color={color.fg3} />
              <Text style={styles.sectionTitle}>{t.languageModalTitle}</Text>
            </View>
            <View style={styles.languageHeaderRight}>
              <Text style={styles.languageValue} numberOfLines={1}>{currentLanguageLabel}</Text>
              <ChevronRight size={18} color={color.fg3} />
            </View>
          </TouchableOpacity>
        </Card>

        <TouchableOpacity style={styles.supportCard} onPress={() => Linking.openURL(SUPPORT_URL)} activeOpacity={0.7}>
          <View style={styles.supportIconTile}>
            <LifeBuoy size={20} color={color.fg} />
          </View>
          <Text style={styles.supportText}>{t.contactSupport}</Text>
          <ChevronRight size={20} color={color.fg3} />
        </TouchableOpacity>
      </ScrollView>

      <PoweredByFooter />

      <HowToPlayModal visible={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
      <PrizeTiersModal visible={prizeTiersOpen} onClose={() => setPrizeTiersOpen(false)} />
      <LanguageModal visible={languageOpen} onClose={() => setLanguageOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgInk },
  container: { flex: 1 },
  containerContent: { padding: space[5], gap: space[4] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f12', padding: 20 },
  title: { color: color.fg, fontSize: 24, fontFamily: FONT_TITLE, marginTop: 12 },
  subtitle: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 17, textAlign: 'center', lineHeight: 24 },
  // Connect screen
  connectScreen: { flex: 1, backgroundColor: color.bgInk },
  connectContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[6], gap: space[5] },
  connectHeadlineGroup: { alignItems: 'center', marginTop: space[2] },
  headline: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 32, textAlign: 'center' },
  // Full-width CTA footer, pinned above the tab bar (not centered/shrink-wrapped like before).
  connectFooter: { paddingHorizontal: space[5], paddingBottom: space[5], paddingTop: space[3] },
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

  // Identity card — Seeker ID + connected wallet, merged into one card
  identityCard: { gap: space[3] },
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
  cardDivider: { height: 1, backgroundColor: color.borderSofter },

  walletHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.success },
  walletHeaderText: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  walletBalanceRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  walletAddress: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 13, flex: 1 },
  walletBalance: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13 },

  // How to play / Prize tiers — both open a modal (HowToPlayModal / PrizeTiersModal)
  section: { padding: 0, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space[4] },
  sectionTitle: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },
  languageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  languageHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  languageValue: { color: color.fg3, fontSize: 14, fontFamily: FONT_BODY_MEDIUM, flexShrink: 1 },

  // Contact support
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: color.surface1,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    padding: space[4],
  },
  supportIconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportText: { flex: 1, color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
});
