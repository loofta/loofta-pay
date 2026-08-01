// MysteryPackOpening.tsx — the full gacha open sequence in React Native. Brought in from the
// designer's handoff (react-native/MysteryPackOpening.tsx.txt) — same beats as the 3D web version
// (idle float → shake → tear apart → confetti → ticket rises), faking depth with perspective
// transforms; no three.js, no Skia, no WebView. Adapted from the handoff's local ODDS/roll() demo
// to call the real, authenticated pack-open API instead (see the README's own "swap roll() for
// your server's result" note) — the shake now loops until that real result actually lands instead
// of resolving on a fixed timer, and the tear/reveal only ever plays for a real server-rolled
// result, never a client-guessed one.
//
//   <MysteryPackOpening canOpen={paid} resolveOpen={...} onOpened={...} onError={...} />
//
// Deps: react-native-svg, react-native-reanimated (already dependencies)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ImageSourcePropType, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  cancelAnimation,
  runOnJS,
  interpolate,
  type SharedValue,
} from 'react-native-reanimated';
import MysteryPack, { PACK_RATIO } from './MysteryPack';
import MegapotTicket from './MegapotTicket';
import type { PackOpenResult } from '../lib/api/pack';
import { FONT_TITLE_SEMIBOLD, FONT_BODY_MEDIUM } from '../lib/fonts';

const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CONFETTI = 26;
const COLORS = ['#FF1301', '#EAB308', '#FFCB3D', '#fff', '#FF6A00'];

type Assets = {
  logoWhite?: ImageSourcePropType;
  logoDark?: ImageSourcePropType;
  megapotDark?: ImageSourcePropType;
};

function Bit({ i, fire }: { i: number; fire: SharedValue<number> }) {
  const seed = useMemo(() => {
    const a = (i / CONFETTI) * Math.PI * 2 + (i % 3);
    return {
      dx: Math.cos(a) * (110 + (i % 5) * 44),
      dy: Math.sin(a) * (110 + (i % 5) * 44) + 90,
      size: 7 + (i % 3) * 5,
      color: COLORS[i % COLORS.length],
    };
  }, [i]);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(fire.value, [0, 0.1, 0.85, 1], [0, 1, 0.9, 0]),
    transform: [
      { translateX: fire.value * seed.dx },
      { translateY: fire.value * seed.dy },
      { rotate: `${fire.value * 540}deg` },
      { scale: 1 - fire.value * 0.5 },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: seed.size,
          height: seed.size * (i % 2 ? 1 : 0.45),
          borderRadius: i % 2 ? seed.size : 2,
          backgroundColor: seed.color,
        },
        st,
      ]}
    />
  );
}

interface Props {
  /** Payment gate — tapping the pack does nothing until this is true. */
  canOpen: boolean;
  /** The already-paid-for open call (pack.ts openPack/demoOpenPack) — payment happens before this. */
  resolveOpen: () => Promise<PackOpenResult>;
  onOpened: (result: PackOpenResult) => void;
  onError: (message: string) => void;
  idleLabel?: string;
  idleSubtitle?: string;
  assets?: Assets;
}

export default function MysteryPackOpening({ canOpen, resolveOpen, onOpened, onError, idleLabel, idleSubtitle, assets = {} }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  const packW = Math.min(sw * 0.62, sh * 0.34 * PACK_RATIO);
  const packH = packW / PACK_RATIO;
  const half = packH / 2;

  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const [result, setResult] = useState<PackOpenResult | null>(null);
  const busyRef = useRef(false);

  const resolveOpenRef = useRef(resolveOpen);
  const onOpenedRef = useRef(onOpened);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    resolveOpenRef.current = resolveOpen;
  }, [resolveOpen]);
  useEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const float = useSharedValue(0); // idle bob
  const shake = useSharedValue(0);
  const tear = useSharedValue(0); // 0 sealed → 1 halves gone
  const fire = useSharedValue(0); // confetti
  const rise = useSharedValue(0); // ticket
  const glow = useSharedValue(0);

  // idle float loop
  useEffect(() => {
    if (phase === 'idle') {
      float.value = withRepeat(
        withSequence(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.quad) })),
        -1,
        false,
      );
    } else {
      cancelAnimation(float);
    }
  }, [phase, float]);

  const open = useCallback(() => {
    if (phase !== 'idle' || !canOpen || busyRef.current) return;
    busyRef.current = true;
    setPhase('busy');

    // Shake loops indefinitely — real network latency, not a fixed demo timer — until the actual
    // server-rolled result lands (or the request fails), same "never fabricate a result" contract
    // the web 3D scene follows.
    glow.value = withTiming(1, { duration: 900 });
    shake.value = withRepeat(withSequence(withTiming(1, { duration: 70 }), withTiming(-1, { duration: 70 })), -1, false);

    resolveOpenRef
      .current()
      .then((r) => {
        cancelAnimation(shake);
        shake.value = withTiming(0, { duration: 120 });
        setResult(r);
        tear.value = withTiming(1, { duration: 780, easing: OUT });
        fire.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) });
        rise.value = withDelay(
          150,
          withTiming(1, { duration: 950, easing: OUT }, (done) => {
            if (done) {
              runOnJS(setPhase)('done');
              runOnJS(onOpenedRef.current)(r);
            }
          }),
        );
      })
      .catch((err) => {
        cancelAnimation(shake);
        shake.value = 0;
        glow.value = withTiming(0, { duration: 200 });
        setPhase('idle');
        onErrorRef.current(err instanceof Error ? err.message : 'Failed to open pack');
      })
      .finally(() => {
        busyRef.current = false;
      });
  }, [phase, canOpen, shake, glow, tear, fire, rise]);

  const packSt = useAnimatedStyle(() => ({
    transform: [
      { translateY: float.value * -12 + shake.value * 4 },
      { translateX: shake.value * 7 },
      { rotate: `${float.value * 0.8 + shake.value * 2.2}deg` },
    ],
  }));
  const topSt = useAnimatedStyle(() => ({
    opacity: 1 - tear.value,
    transform: [{ perspective: 900 }, { translateY: -tear.value * packH * 0.95 }, { rotateX: `${-tear.value * 62}deg` }, { rotate: `${-tear.value * 14}deg` }],
  }));
  const botSt = useAnimatedStyle(() => ({
    opacity: 1 - tear.value,
    transform: [{ perspective: 900 }, { translateY: tear.value * packH * 0.95 }, { rotateX: `${tear.value * 62}deg` }, { rotate: `${tear.value * 14}deg` }],
  }));
  const ticketSt = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ perspective: 900 }, { translateY: (1 - rise.value) * 120 }, { scale: 0.6 + rise.value * 0.4 }, { rotateY: `${(1 - rise.value) * 420}deg` }],
  }));
  const glowSt = useAnimatedStyle(() => ({ opacity: glow.value * 0.55 }));

  return (
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[styles.glow, { width: packW * 2.6, height: packW * 2.6, borderRadius: packW * 1.3 }, glowSt]} />

      <Pressable onPress={open} disabled={!canOpen || phase !== 'idle'} style={{ width: packW, height: packH, alignItems: 'center', justifyContent: 'center' }}>
        {/* pack: two halves that tear apart */}
        {phase !== 'done' && (
          <Animated.View style={[StyleSheet.absoluteFill, packSt]}>
            <Animated.View style={[styles.halfBox, { height: half }, topSt]}>
              <MysteryPack width={packW} logoWhite={assets.logoWhite} megapotDark={assets.megapotDark} />
            </Animated.View>
            <Animated.View style={[styles.halfBox, { height: half, top: half }, botSt]}>
              <View style={{ marginTop: -half }}>
                <MysteryPack width={packW} logoWhite={assets.logoWhite} megapotDark={assets.megapotDark} />
              </View>
            </Animated.View>
          </Animated.View>
        )}

        {/* confetti */}
        <View style={styles.center} pointerEvents="none">
          {Array.from({ length: CONFETTI }, (_, i) => (
            <Bit key={i} i={i} fire={fire} />
          ))}
        </View>

        {/* revealed ticket */}
        <Animated.View style={[styles.center, ticketSt]} pointerEvents="none">
          <MegapotTicket width={packW * 0.72} entries={result?.ticketsAwarded ?? 1} logo={assets.logoDark} />
        </Animated.View>
      </Pressable>

      {(idleLabel || idleSubtitle) && phase !== 'done' && (
        <View style={styles.hud}>
          {!!idleLabel && <Text style={styles.lbl}>{phase === 'busy' ? 'Opening…' : idleLabel}</Text>}
          {!!idleSubtitle && phase === 'idle' && <Text style={styles.sub}>{idleSubtitle}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', backgroundColor: '#FF6A00', opacity: 0 },
  halfBox: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hud: { marginTop: 24, alignItems: 'center', minHeight: 44 },
  lbl: { fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 20, color: '#F0EDE4', textAlign: 'center' },
  sub: { fontFamily: FONT_BODY_MEDIUM, fontSize: 14, color: '#8B8882', marginTop: 6, textAlign: 'center' },
});
