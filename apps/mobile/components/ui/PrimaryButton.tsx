import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { color, primaryShadow, radius, space } from '../../lib/theme';
import { FONT_BODY_SEMIBOLD } from '../../lib/fonts';

/** Solid brandOrange fill, soft shadow — no gradient fill per the design spec. */
export function PrimaryButton({
  onPress,
  disabled,
  children,
  label,
}: {
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.button, disabled && styles.disabled]}
    >
      {children ?? <Text style={styles.label}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: color.brandOrange,
    borderRadius: radius.lg,
    paddingVertical: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space[2],
    ...primaryShadow,
  },
  disabled: { opacity: 0.35, shadowOpacity: 0 },
  label: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
});
