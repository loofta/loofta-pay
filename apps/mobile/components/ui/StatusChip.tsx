import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY_MEDIUM } from '../../lib/fonts';

export type StatusChipTone = 'amber' | 'success' | 'neutral' | 'danger';

const TONE_STYLE: Record<StatusChipTone, { bg: string; fg: string }> = {
  amber: { bg: 'rgba(245,158,11,0.14)', fg: color.warn },
  success: { bg: 'rgba(52,211,153,0.14)', fg: color.success },
  neutral: { bg: color.surface3, fg: color.fg3 },
  danger: { bg: 'rgba(239,68,68,0.14)', fg: color.danger },
};

export function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: StatusChipTone }) {
  const t = TONE_STYLE[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: space[2] + 4, paddingVertical: 5, borderRadius: radius.pill },
  label: { fontFamily: FONT_BODY_MEDIUM, fontSize: 13 },
});
