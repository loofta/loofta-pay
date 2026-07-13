import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTranslation } from '../lib/i18n/LanguageProvider';
import type { Translations } from '../lib/i18n/locales';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY, FONT_BODY_SEMIBOLD, FONT_TITLE_SEMIBOLD } from '../lib/fonts';
import { PrimaryButton } from './ui/PrimaryButton';

type PrizeTierMatchKey = keyof Translations['prizeTierMatch'];

// Snapshot of Megapot's published tiers (docs.megapot.io/learn/prize-structure, taken
// 2026-07-12 against a ~$1.1M pool), net of the ~10% on-chain referral cut Loofta actually
// takes on every cash win (mirrors the web prize table at apps/frontend/.../megapot/page.tsx
// and DEFAULT_REFERRAL_WIN_SHARE_FACTOR in megapot.service.ts). Megapot's pool grows daily,
// so these drift out of date — re-pull from the docs page periodically. `matchKey` looks up the
// localized "5 + bonus" style label in t.prizeTierMatch — the dollar amounts stay numeric/untranslated.
const PRIZE_TIERS: { matchKey: PrizeTierMatchKey; prize: string; normal: number; bonusMatch: boolean }[] = [
  { matchKey: '5_bonus', prize: '$183,918.03', normal: 5, bonusMatch: true },
  { matchKey: '5', prize: '$1,858.64', normal: 5, bonusMatch: false },
  { matchKey: '4_bonus', prize: '$179.24', normal: 4, bonusMatch: true },
  { matchKey: '4', prize: '$20.71', normal: 4, bonusMatch: false },
  { matchKey: '3_bonus', prize: '$8.33', normal: 3, bonusMatch: true },
  { matchKey: '2_bonus', prize: '$4.77', normal: 2, bonusMatch: true },
  { matchKey: '3', prize: '$4.19', normal: 3, bonusMatch: false },
  { matchKey: '1_bonus', prize: '$2.66', normal: 1, bonusMatch: true },
  { matchKey: '2', prize: 'FREE_TICKET', normal: 2, bonusMatch: false },
  { matchKey: 'bonus_only', prize: 'FREE_TICKET', normal: 0, bonusMatch: true },
];

function TierBalls({ normal, bonusMatch }: { normal: number; bonusMatch: boolean }) {
  return (
    <View style={styles.ballsRow}>
      {Array.from({ length: 5 }, (_, i) => (
        <View key={i} style={[styles.ball, i < normal ? styles.ballFilled : styles.ballEmpty]} />
      ))}
      <View style={styles.ballDivider} />
      <View style={[styles.ball, bonusMatch ? styles.ballBonus : styles.ballEmpty]} />
    </View>
  );
}

export function PrizeTiersModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t.prizeTiersTitle}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
              <X size={18} color={color.fg3} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.bodyContent}>
            <Text style={styles.intro}>{t.prizeTiersIntro}</Text>

            <Text style={styles.sectionLabel}>{t.prizeTiersSectionTiers}</Text>
            <View style={styles.tierList}>
              {PRIZE_TIERS.map((tier, i) => {
                const free = tier.prize === 'FREE_TICKET';
                const prizeLabel = free ? t.freeTicket : tier.prize;
                return (
                  <View key={tier.matchKey} style={[styles.tierRow, i < PRIZE_TIERS.length - 1 && styles.tierRowDivider]}>
                    <View style={styles.tierLeft}>
                      <TierBalls normal={tier.normal} bonusMatch={tier.bonusMatch} />
                      <Text style={styles.tierMatch}>{t.prizeTierMatch[tier.matchKey]}</Text>
                    </View>
                    <Text style={[styles.tierPrize, free && styles.tierPrizeFree]}>{prizeLabel}</Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>{t.prizeTiersSectionBallRange}</Text>
            <View style={styles.rangeRow}>
              <View style={styles.rangeBox}>
                <View style={styles.rangeNumbers}>
                  <View style={styles.rangeBadge}><Text style={styles.rangeBadgeText}>1</Text></View>
                  <Text style={styles.rangeArrow}>→</Text>
                  <View style={styles.rangeBadge}><Text style={styles.rangeBadgeText}>30</Text></View>
                </View>
                <Text style={styles.rangeCaption}>{t.prizeTiers30Normal}</Text>
              </View>
              <View style={styles.rangeBox}>
                <View style={styles.rangeNumbers}>
                  <View style={[styles.rangeBadge, styles.rangeBadgeBonus]}><Text style={styles.rangeBadgeText}>1</Text></View>
                  <Text style={styles.rangeArrow}>→</Text>
                  <View style={[styles.rangeBadge, styles.rangeBadgeBonus]}><Text style={styles.rangeBadgeText}>12</Text></View>
                </View>
                <Text style={styles.rangeCaption}>{t.prizeTiers12Bonus}</Text>
              </View>
            </View>
          </ScrollView>

          <PrimaryButton label={t.gotIt} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.bgInkSoft,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[6],
    paddingTop: space[3],
    paddingBottom: space[8],
    maxHeight: '86%',
    gap: space[4],
  },
  grabber: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space[2] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 20 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface3,
  },
  bodyContent: { gap: space[3], paddingBottom: space[2] },
  intro: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: space[2] },
  sectionLabel: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16, marginTop: space[2] },

  tierList: { borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.lg, overflow: 'hidden' },
  tierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[3] },
  tierRowDivider: { borderBottomWidth: 1, borderBottomColor: color.borderSofter },
  tierLeft: { gap: 6 },
  tierMatch: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 16 },
  tierPrize: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  tierPrizeFree: { color: color.brandOrange },

  ballsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ball: { width: 18, height: 18, borderRadius: radius.pill, borderWidth: 1 },
  ballFilled: { backgroundColor: 'rgba(255,74,38,0.3)', borderColor: 'rgba(255,74,38,0.7)' },
  ballEmpty: { backgroundColor: color.surface3, borderColor: color.borderSoft },
  ballBonus: { backgroundColor: color.bgInkSoft, borderColor: color.borderStrong },
  ballDivider: { width: 1, height: 16, backgroundColor: color.borderSofter, marginHorizontal: 2 },

  rangeRow: { flexDirection: 'row', gap: space[3] },
  rangeBox: { flex: 1, borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md, backgroundColor: color.surface3, paddingVertical: space[4], alignItems: 'center', gap: space[2] },
  rangeNumbers: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  rangeBadge: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  rangeBadgeBonus: { backgroundColor: color.bgInkSoft },
  rangeBadgeText: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  rangeArrow: { color: color.brandOrange, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  rangeCaption: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 14 },
});
