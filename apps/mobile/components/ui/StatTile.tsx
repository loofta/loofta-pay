import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY, FONT_TITLE_SEMIBOLD } from '../../lib/fonts';
import { Card } from './Card';

export function StatTile({ icon, label, value, tone = 'default' }: { icon: ReactNode; label: string; value: string; tone?: 'default' | 'success' }) {
  return (
    <Card style={styles.tile}>
      {icon}
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone === 'success' && styles.valueSuccess]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, gap: space[2], alignItems: 'flex-start', padding: space[4] },
  label: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' },
  value: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 26, fontVariant: ['tabular-nums'] },
  valueSuccess: { color: color.success },
});
