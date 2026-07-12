import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY_MEDIUM } from '../../lib/fonts';

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: space[3] + 2,
    paddingVertical: space[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.borderSoft,
    backgroundColor: color.surface1,
  },
  pillActive: { borderColor: color.brandOrange, backgroundColor: 'rgba(255,74,38,0.14)' },
  label: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 15 },
  labelActive: { color: color.brandOrange },
});
