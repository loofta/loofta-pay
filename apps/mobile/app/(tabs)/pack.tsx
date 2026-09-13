// Mystery Pack — $2 real-money pack, always wins 1-100 Megapot tickets. Ported from
// apps/frontend/src/app/app/megapot/packs/page.tsx, adapted to this app's own primitives: MWA
// signing (lib/wallet/mwa.ts) instead of Privy's embedded-wallet signer, and a plain PrimaryButton
// pay CTA instead of the web's custom slide-to-pay drag gesture. The pack-opening visual is
// MysteryPackOpening — a flat/2D react-native-svg + reanimated approximation, not the desktop's
// real WebGL scene: the GL version (expo-gl + three.js + Skia-baked textures, see git history for
// MegapotPackGL/megapotPackTextures.tsx) always rendered at full PBR quality with no adaptive
// downgrade and produced unacceptable jank on real devices, so it was dropped in favor of this.
//
// Lives as its own tab (not a pushed modal route, see git history for the prior app/mystery-pack.tsx)
// so it's directly reachable from the tab bar alongside Buy/Redeem/History/Settings.
import { usePrivy } from '@privy-io/expo';
import { Info, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MysteryPackOpening from '../../components/MysteryPackOpening';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GhostButton } from '../../components/ui/GhostButton';
import { Card } from '../../components/ui/Card';
import { AuthGate } from '../../components/AuthGate';
import {
  buildPackPaymentTx,
  demoOpenPack,
  getMyPackStatus,
  getPackConfig,
  getPendingPackPayment,
  openPack,
  type PackConfig,
  type PackOpenResult,
  type PackRarity,
} from '../../lib/api/pack';
import { fmt } from '../../lib/lottery/fees';
import { getCachedPackConfig, setCachedPackConfig } from '../../lib/storage/packConfigCache';
import { connectSeekerWallet, signAndSendTransactionWithSeeker } from '../../lib/wallet/mwa';
import { useBalances } from '../../lib/wallet/BalanceProvider';
import { useTranslation } from '../../lib/i18n/LanguageProvider';
import type { Translations } from '../../lib/i18n/locales';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_TITLE_SEMIBOLD } from '../../lib/fonts';

const FALLBACK_PRICE_USDC = 2;
const RARITY_ORDER: PackRarity[] = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_COLOR: Record<PackRarity, string> = {
  common: color.fg3,
  uncommon: color.success,
  rare: '#A78BFA',
  epic: color.brandYellow,
};

function friendlyPackPayError(err: unknown, priceLabel: string, t: Translations): string {
  const raw = err instanceof Error ? err.message : '';
  const s = raw.toLowerCase();
  if (s.includes('insufficient funds')) return t.mysteryPackInsufficientFundsError(priceLabel);
  if (s.includes('cancel') || s.includes('denied') || s.includes('reject')) return t.mysteryPackPaymentCancelled;
  return raw && raw.length < 200 ? raw : t.mysteryPackPaymentFailed;
}

function OddsModal({
  visible,
  onClose,
  config,
  priceLabel,
}: {
  visible: boolean;
  onClose: () => void;
  config: PackConfig | null;
  priceLabel: string;
}) {
  const { t } = useTranslation();
  const rarityGroups = useMemo(() => {
    const grouped: Record<PackRarity, number[]> = { common: [], uncommon: [], rare: [], epic: [] };
    (config?.tiers ?? []).forEach((tier) => grouped[tier.rarity]?.push(tier.ticketsAwarded));
    return RARITY_ORDER.filter((r) => grouped[r].length).map((r) => {
      const nums = [...grouped[r]].sort((a, b) => a - b);
      const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
      return { rarity: r, label };
    });
  }, [config]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.sheetTitle}>{t.mysteryPackOddsTitle}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
              <X size={18} color={color.fg3} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <Text style={styles.oddsIntro}>{t.mysteryPackOddsIntro(priceLabel)}</Text>
            <View style={styles.oddsGrid}>
              {rarityGroups.map((g) => (
                <View key={g.rarity} style={[styles.oddsTile, { borderColor: RARITY_COLOR[g.rarity] }]}>
                  <Text style={[styles.oddsTileLabel, { color: RARITY_COLOR[g.rarity] }]}>{t.mysteryPackRarity[g.rarity]}</Text>
                  <Text style={styles.oddsTileValue}>{`${g.label} ${t.mysteryPackTicketsSuffix}`}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <PrimaryButton label={t.gotIt} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function MysteryPackInner() {
  const { getAccessToken } = usePrivy();
  const { t, localeTag } = useTranslation();
  const { usdcBalance, balancesLoaded, refreshBalances } = useBalances();
  const insets = useSafeAreaInsets();

  const [config, setConfig] = useState<PackConfig | null>(null);
  const [dailyLimitReached, setDailyLimitReached] = useState<boolean | null>(null);

  const [paid, setPaid] = useState(false);
  const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Dev-only: same real tier roll as a real open, no payment and no real ticket — the backend
  // hard-blocks this outside development regardless of what this sends (see PackController), so
  // gating the toggle behind __DEV__ is purely cosmetic, matching web's IS_LOCALHOST gate.
  const [demoMode, setDemoMode] = useState(false);

  const [openError, setOpenError] = useState<string | null>(null);
  const [result, setResult] = useState<PackOpenResult | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [oddsOpen, setOddsOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      const status = await getMyPackStatus(accessToken);
      setDailyLimitReached(status.limitReached);
    } catch {
      // best-effort — the backend still enforces this at payment time regardless
    }
  }, [getAccessToken]);

  useEffect(() => {
    (async () => {
      // Cache-first: paint the last known config immediately (same pattern as BalanceProvider)
      // instead of sitting on FALLBACK_PRICE_USDC until the network call below resolves. Pending
      // payment / daily limit are never cached — always fetched live, they're real money state.
      const cached = await getCachedPackConfig();
      if (cached) setConfig(cached);

      try {
        const accessToken = await getAccessToken();
        const [cfg, pending] = await Promise.all([getPackConfig(accessToken), getPendingPackPayment(accessToken)]);
        setConfig(cfg);
        void setCachedPackConfig(cfg);
        if (pending.paymentTxHash) {
          setPaymentTxHash(pending.paymentTxHash);
          setPaid(true);
        }
      } catch {
        // config falls back to the cached value above, or FALLBACK_PRICE_USDC if there was none
      }
      refreshStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const priceUsdc = config?.priceUsdc ?? FALLBACK_PRICE_USDC;
  const priceLabel = demoMode ? '$0' : fmt(priceUsdc, localeTag);
  // Demo mode never touches the treasury, the daily limit, or the caller's own balance — always
  // shows the real pay control so the flow itself stays testable, mirrors web exactly.
  const insufficientBalance = !demoMode && balancesLoaded && usdcBalance != null && usdcBalance < priceUsdc;

  const handlePay = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    try {
      // Same slide-to-pay UX as a real payment (so the flow itself is actually testable), but no
      // wallet signature and no on-chain transfer at all — mirrors web's demo behavior exactly.
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 300));
        setPaid(true);
        return;
      }

      const accessToken = await getAccessToken();

      // Guard against paying twice for one intended pack — reuse an already-landed payment the
      // caller never redeemed instead of charging again (same recovery the initial load does).
      const pending = await getPendingPackPayment(accessToken);
      if (pending.paymentTxHash) {
        setPaymentTxHash(pending.paymentTxHash);
        setPaid(true);
        return;
      }

      const { base58Address } = await connectSeekerWallet();
      const { txBase64 } = await buildPackPaymentTx(base58Address, accessToken);
      const signature = await signAndSendTransactionWithSeeker(txBase64);
      void refreshBalances();
      setPaymentTxHash(signature);
      setPaid(true);
    } catch (err) {
      setPayError(friendlyPackPayError(err, priceLabel, t));
    } finally {
      setPaying(false);
    }
  }, [demoMode, getAccessToken, priceLabel, refreshBalances, t]);

  const resolveOpen = useCallback(async (): Promise<PackOpenResult> => {
    setOpenError(null);
    const accessToken = await getAccessToken();
    if (demoMode) return demoOpenPack(accessToken);
    if (!paymentTxHash) throw new Error(t.mysteryPackGenericError);
    return openPack(paymentTxHash, accessToken);
  }, [demoMode, getAccessToken, paymentTxHash, t]);

  const handleOpened = useCallback(
    (r: PackOpenResult) => {
      setPaid(false);
      setPaymentTxHash(null);
      setResult(r);
      // This open may have been the last one allowed today — re-check so "Open another" shows
      // the limit message instead of a payment gate doomed to fail.
      refreshStatus();
    },
    [refreshStatus],
  );

  const handleOpenAnother = useCallback(() => {
    setResult(null);
    setOpenError(null);
    setOpenCount((n) => n + 1);
  }, []);

  // A tab, not a pushed modal — "Done" just returns to the pay gate instead of router.back()ing
  // out of a screen with nothing behind it in the tab's own stack.
  const handleDone = useCallback(() => {
    setResult(null);
    setOpenCount((n) => n + 1);
  }, []);

  const idleSubtitle = demoMode ? t.mysteryPackDemoSubtitle : t.mysteryPackAlwaysWin;

  return (
    <View style={styles.screen}>
      {/* Not inside the ScrollView — stays pinned to the top regardless of scroll position. */}
      <View style={styles.topRow}>
        {__DEV__ && (
          <TouchableOpacity
            style={[styles.demoButton, demoMode && styles.demoButtonActive]}
            onPress={() => setDemoMode((d) => !d)}
            activeOpacity={0.7}
          >
            <Text style={[styles.demoButtonLabel, demoMode && styles.demoButtonLabelActive]}>{t.mysteryPackDemo}</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.oddsButton} onPress={() => setOddsOpen(true)} activeOpacity={0.7}>
          <Info size={16} color={color.fg2} />
          <Text style={styles.oddsButtonLabel}>{t.mysteryPackOdds}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MysteryPackOpening
          key={openCount}
          canOpen={paid}
          resolveOpen={resolveOpen}
          onOpened={handleOpened}
          onError={setOpenError}
          idleLabel={paid ? t.mysteryPackTapToOpen : undefined}
          idleSubtitle={paid ? idleSubtitle : undefined}
        />

        {openError && <Text style={styles.errorText}>{openError}</Text>}
      </ScrollView>

      {/* Not inside the ScrollView — the CTA (pay gate or result actions) stays pinned to the
          bottom of the screen regardless of scroll position or content height above it. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        {/* Shown immediately with FALLBACK_PRICE_USDC rather than waiting on getPackConfig's
            round trip — a Pay button that's briefly showing the fallback price beats a blank
            footer while the network call is in flight. */}
        {!paid && !result && (
          <Card style={styles.gateCard}>
            {insufficientBalance ? (
              <View style={styles.gateMessage}>
                <Text style={styles.gateTitle}>{t.mysteryPackInsufficientTitle}</Text>
                <Text style={styles.gateSubtitle}>{t.mysteryPackInsufficientSubtitle}</Text>
              </View>
            ) : !demoMode && dailyLimitReached === true ? (
              <View style={styles.gateMessage}>
                <Text style={styles.gateTitle}>{t.mysteryPackLimitTitle}</Text>
                <Text style={styles.gateSubtitle}>{t.mysteryPackLimitSubtitle}</Text>
              </View>
            ) : !demoMode && config?.available === false ? (
              <View style={styles.gateMessage}>
                <Text style={styles.gateTitle}>{t.mysteryPackUnavailableTitle}</Text>
                <Text style={styles.gateSubtitle}>{t.mysteryPackUnavailableSubtitle}</Text>
              </View>
            ) : (
              <>
                <PrimaryButton
                  label={paying ? t.mysteryPackConfirming : t.mysteryPackPayCta(priceLabel)}
                  onPress={handlePay}
                  disabled={paying}
                />
                {payError && <Text style={styles.errorText}>{payError}</Text>}
              </>
            )}
          </Card>
        )}

        {result && (
          <Card style={styles.resultCard}>
            <Text style={[styles.resultRarity, { color: RARITY_COLOR[result.rarity] }]}>{t.mysteryPackRarity[result.rarity]}</Text>
            <Text style={styles.resultTitle}>{t.mysteryPackTicketsWon(result.ticketsAwarded)}</Text>
            <Text style={styles.resultSubtitle}>{t.mysteryPackAddedToDraw}</Text>
            <View style={styles.resultActions}>
              <PrimaryButton label={t.mysteryPackOpenAnother} onPress={handleOpenAnother} />
              <GhostButton label={t.mysteryPackDone} onPress={handleDone} />
            </View>
          </Card>
        )}
      </View>

      <OddsModal visible={oddsOpen} onClose={() => setOddsOpen(false)} config={config} priceLabel={priceLabel} />
    </View>
  );
}

export default function PackScreen() {
  return (
    <AuthGate>
      <MysteryPackInner />
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgInk },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[5], paddingTop: space[3], gap: space[2] },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space[5], gap: space[5] },
  oddsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.surface1,
    borderWidth: 1,
    borderColor: color.borderSoft,
  },
  oddsButtonLabel: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 13 },
  demoButton: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.surface1,
    borderWidth: 1,
    borderColor: color.borderSoft,
  },
  demoButtonActive: { backgroundColor: 'rgba(52,211,153,0.14)', borderColor: color.success },
  demoButtonLabel: { color: color.fg3, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 12, letterSpacing: 0.5 },
  demoButtonLabelActive: { color: color.success },
  errorText: { color: color.danger, fontFamily: FONT_BODY_MEDIUM, fontSize: 14, textAlign: 'center' },
  footer: { paddingHorizontal: space[5], paddingTop: space[3] },
  gateCard: { width: '100%', gap: space[3] },
  gateMessage: { alignItems: 'center', gap: 6 },
  gateTitle: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 16, textAlign: 'center' },
  gateSubtitle: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 14, textAlign: 'center' },
  resultCard: { width: '100%', alignItems: 'center', gap: 6 },
  resultRarity: { fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  resultTitle: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 22, marginTop: 2 },
  resultSubtitle: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 14, marginBottom: space[3] },
  resultActions: { width: '100%', gap: space[3] },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.bgInkSoft,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[6],
    paddingTop: space[3],
    paddingBottom: space[8],
    maxHeight: '70%',
    gap: space[4],
  },
  grabber: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space[2] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 20 },
  closeButton: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface3 },
  bodyContent: { gap: space[3], paddingBottom: space[2] },
  oddsIntro: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: space[2] },
  oddsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  oddsTile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, backgroundColor: color.surface1, padding: space[4], gap: 4 },
  oddsTileLabel: { fontFamily: FONT_BODY_SEMIBOLD, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  oddsTileValue: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 16 },
});
