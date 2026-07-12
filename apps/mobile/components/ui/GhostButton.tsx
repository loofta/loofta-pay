import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY_SEMIBOLD } from '../../lib/fonts';

export function GhostButton({
  onPress,
  disabled,
  children,
  label,
  tone = 'default',
}: {
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  label?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.button, disabled && styles.disabled]}
    >
      {children ?? <Text style={[styles.label, tone === 'danger' && styles.labelDanger]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space[2],
  },
  disabled: { opacity: 0.35 },
  label: { color: color.fg2, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 14 },
  labelDanger: { color: color.brandOrange },
});
