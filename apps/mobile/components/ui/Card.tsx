import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, radius, space } from '../../lib/theme';

export function Card({ children, style, tint }: { children: ReactNode; style?: ViewStyle; tint?: 'success' }) {
  return <View style={[styles.card, tint === 'success' && styles.cardSuccess, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface1,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    padding: space[5],
  },
  cardSuccess: { borderColor: 'rgba(52,211,153,0.25)' },
});
