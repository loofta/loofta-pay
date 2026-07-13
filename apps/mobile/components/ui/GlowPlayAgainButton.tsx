import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { GradientText } from './GradientText';
import { color, radius } from '../../lib/theme';
import { FONT_BODY_BOLD } from '../../lib/fonts';

const GLOW_COLORS = ['#34d399', '#22d3ee', '#fbbf24', '#a78bfa', '#34d399'] as const;

/** Pulsing multi-color glow border — mirrors web's GlowPlayAgainButton
 *  (apps/frontend/.../megapot/page.tsx) so "Play again" reads as the featured, better-deal CTA
 *  on mobile too, instead of the plain solid PrimaryButton every other action uses. */
function useGlowPulse() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
}

export function GlowPlayAgainButton({ onPress, disabled, children }: {
  onPress?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const glowOpacity = useGlowPulse();

  return (
    <View style={disabled ? { opacity: 0.4 } : undefined}>
      <Animated.View style={[styles.glow, { opacity: glowOpacity }]}>
        <LinearGradient colors={GLOW_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={styles.button}>
        {typeof children === 'string' ? (
          <GradientText style={styles.label} colors={['#6ee7b7', '#99f6e4', '#fde68a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {children}
          </GradientText>
        ) : (
          children
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Static variant of the same glow border, for framing a result (not an action) — used on the
 *  "Played again" success card so the new ticket count gets the same featured treatment. */
export function GlowCard({ children, style }: { children: ReactNode; style?: object }) {
  const glowOpacity = useGlowPulse();
  return (
    <View style={style}>
      <Animated.View style={[styles.glow, { opacity: glowOpacity }]}>
        <LinearGradient colors={GLOW_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={styles.cardInner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -2.5,
    left: -2.5,
    right: -2.5,
    bottom: -2.5,
    borderRadius: radius.lg + 3,
    overflow: 'hidden', // clips the LinearGradient fill to the rounded corners — without this the
    // gradient renders as a plain rect and the "border" reads as square
  },
  button: {
    backgroundColor: '#0d0d11',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInner: {
    backgroundColor: color.bgInk,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    padding: 20,
  },
  label: { fontFamily: FONT_BODY_BOLD, fontSize: 16 },
});
