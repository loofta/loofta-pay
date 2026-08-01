// MysteryPack.tsx — the Loofta × Megapot Mystery Pack, faithful to the web/3D version.
// Pure react-native-svg + RN views. No three.js, no Skia, no canvas — brought in from the
// designer's React Native handoff (react-native/MysteryPack.tsx.txt) rather than reinvented,
// since RN has no Canvas 2D API for the web version's procedural texture generation.
//
//   <MysteryPack width={300} shine={0.4} />
//   <MysteryPack width={300} face="back" />
//
// Deps: react-native-svg (already a dependency — no new native module needed for this file).

import React from 'react';
import { View, Text, Image, StyleSheet, ImageSourcePropType } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, G } from 'react-native-svg';
import { FONT_TITLE_SEMIBOLD, FONT_BODY_SEMIBOLD } from '../lib/fonts';

// artwork is authored at 760 × 1120, same as the 3D pack texture
export const ART_W = 760;
export const ART_H = 1120;
export const PACK_RATIO = 2.32 / 3.6; // width / height

type Props = {
  width: number;
  face?: 'front' | 'back';
  /** 0 → 1 sweeps a gloss highlight across the foil. */
  shine?: number;
  logoWhite?: ImageSourcePropType;
  megapotDark?: ImageSourcePropType;
  displayFont?: string;
  bodyFont?: string;
};

/** four-point sparkle */
function Sparkle({ cx, cy, r, o = 1 }: { cx: number; cy: number; r: number; o?: number }) {
  const d =
    `M ${cx} ${cy - r} Q ${cx + r * 0.16} ${cy - r * 0.16} ${cx + r} ${cy}` +
    ` Q ${cx + r * 0.16} ${cy + r * 0.16} ${cx} ${cy + r}` +
    ` Q ${cx - r * 0.16} ${cy + r * 0.16} ${cx - r} ${cy}` +
    ` Q ${cx - r * 0.16} ${cy - r * 0.16} ${cx} ${cy - r} Z`;
  return <Path d={d} fill="#fff" opacity={o} />;
}

/** serrated heat-seal band. dir = 1 → teeth point down */
function Crimp({ y, h, dir }: { y: number; h: number; dir: 1 | -1 }) {
  const teeth = 30,
    tw = ART_W / teeth;
  const base = dir > 0 ? y + h : y,
    tip = base + dir * 15;
  let d = `M 0 ${base}`;
  for (let i = 0; i < teeth; i++) d += ` L ${i * tw + tw / 2} ${tip} L ${(i + 1) * tw} ${base}`;
  d += ' Z';
  const ridges = [];
  for (let i = 0; i < ART_W; i += 9) ridges.push(i);
  return (
    <G>
      <Rect x={0} y={y} width={ART_W} height={h} fill="#4A0C02" opacity={0.28} />
      {ridges.map((i) => (
        <Rect key={i} x={i} y={y} width={3} height={h} fill="#fff" opacity={0.18} />
      ))}
      <Path d={d} fill="#4A0C02" opacity={0.28} />
    </G>
  );
}

/** radial starburst behind the medallion */
function Starburst({ cx, cy }: { cx: number; cy: number }) {
  const rays = [];
  for (let i = 0; i < 28; i += 2) {
    const a = (i / 28) * Math.PI * 2;
    const s = 0.055;
    rays.push(
      <Path
        key={i}
        d={
          `M ${cx} ${cy} L ${cx + Math.cos(a - s) * 900} ${cy + Math.sin(a - s) * 900}` +
          ` L ${cx + Math.cos(a + s) * 900} ${cy + Math.sin(a + s) * 900} Z`
        }
        fill="#fff"
        opacity={0.14}
      />,
    );
  }
  return <G>{rays}</G>;
}

export default function MysteryPack({
  width,
  face = 'front',
  shine = -1,
  logoWhite,
  megapotDark,
  displayFont = FONT_TITLE_SEMIBOLD,
  bodyFont = FONT_BODY_SEMIBOLD,
}: Props) {
  const w = width;
  const h = w / PACK_RATIO;
  const k = w / ART_W; // artwork → screen scale
  const cx = ART_W / 2,
    cy = 800; // medallion centre

  return (
    <View style={[styles.pack, { width: w, height: h, borderRadius: w * 0.05 }]}>
      <Svg width={w} height={h} viewBox={`0 0 ${ART_W} ${ART_H}`}>
        <Defs>
          <LinearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FF1301" />
            <Stop offset="0.42" stopColor="#FF6A00" />
            <Stop offset="0.72" stopColor="#EAB308" />
            <Stop offset="1" stopColor="#FF3D00" />
          </LinearGradient>
          <LinearGradient id="holo" x1="0" y1="0" x2="1" y2="0.3">
            <Stop offset="0.08" stopColor="#FF0078" stopOpacity="0" />
            <Stop offset="0.22" stopColor="#FF0078" stopOpacity="0.42" />
            <Stop offset="0.36" stopColor="#FFDC00" stopOpacity="0.42" />
            <Stop offset="0.5" stopColor="#00DCFF" stopOpacity="0.38" />
            <Stop offset="0.66" stopColor="#00DCFF" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="gold" cx="0.34" cy="0.3" r="0.75">
            <Stop offset="0" stopColor="#FFF6D8" />
            <Stop offset="0.56" stopColor="#FFD349" />
            <Stop offset="1" stopColor="#E08A00" />
          </RadialGradient>
          <LinearGradient id="pouchX" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#4A0C02" stopOpacity="0.34" />
            <Stop offset="0.17" stopColor="#4A0C02" stopOpacity="0" />
            <Stop offset="0.42" stopColor="#fff" stopOpacity="0.16" />
            <Stop offset="0.66" stopColor="#4A0C02" stopOpacity="0" />
            <Stop offset="1" stopColor="#4A0C02" stopOpacity="0.3" />
          </LinearGradient>
        </Defs>

        {/* foil base + holographic sweep */}
        <Rect width={ART_W} height={ART_H} fill="url(#foil)" />
        <Rect width={ART_W} height={ART_H} fill="url(#holo)" />

        {face === 'front' && <Starburst cx={cx} cy={cy} />}

        {/* heat seals + hang hole */}
        <Crimp y={0} h={52} dir={1} />
        <Crimp y={ART_H - 52} h={52} dir={-1} />
        <Ellipse cx={cx} cy={90} rx={34} ry={17} fill="#4A0C02" opacity={0.34} />

        {face === 'front' ? (
          <G>
            <Sparkle cx={120} cy={250} r={26} o={0.9} />
            <Sparkle cx={650} cy={206} r={20} o={0.8} />
            <Sparkle cx={90} cy={430} r={15} o={0.7} />
            <Sparkle cx={676} cy={404} r={28} o={0.85} />
            <Sparkle cx={150} cy={540} r={12} o={0.6} />
            {/* gold mystery medallion */}
            <Circle cx={cx} cy={cy} r={150} fill="url(#gold)" stroke="#FFFDF7" strokeWidth={12} />
            <Circle cx={cx} cy={cy} r={124} fill="none" stroke="#7A3A00" strokeWidth={4} opacity={0.45} />
            <Sparkle cx={cx - 186} cy={cy - 118} r={32} o={0.95} />
            <Sparkle cx={cx + 196} cy={cy + 96} r={24} o={0.9} />
            <Sparkle cx={cx + 150} cy={cy - 150} r={17} o={0.8} />
            <Sparkle cx={cx - 160} cy={cy + 150} r={20} o={0.75} />
          </G>
        ) : (
          <Rect x={cx - 48} y={ART_H / 2 - 112} width={96} height={4} fill="#fff" opacity={0.5} />
        )}

        {/* pouch shading: centre bulge, pinched sides */}
        <Rect width={ART_W} height={ART_H} fill="url(#pouchX)" />
      </Svg>

      {/* ---- text + logo overlays (RN text stays crisp at any size) ---- */}
      {face === 'front' ? (
        <>
          {logoWhite && (
            <Image
              source={logoWhite}
              resizeMode="contain"
              style={[styles.abs, { top: 150 * k, left: ((ART_W - 300) / 2) * k, width: 300 * k, height: 84 * k }]}
            />
          )}
          <Text
            style={[
              styles.abs,
              styles.center,
              {
                top: 250 * k,
                width: w,
                fontFamily: displayFont,
                fontSize: 104 * k,
                lineHeight: 96 * k,
                color: '#fff',
                textShadowColor: '#5A1002',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 13 * k,
              },
            ]}
          >
            {'MYSTERY\nPACK'}
          </Text>
          <Text
            style={[
              styles.abs,
              styles.center,
              { top: (cy - 118) * k, width: w, fontFamily: displayFont, fontSize: 196 * k, color: '#B23A00' },
            ]}
          >
            ?
          </Text>
          {megapotDark && (
            <View
              style={[
                styles.plate,
                { bottom: 88 * k, left: ((ART_W - 270) / 2) * k, width: 270 * k, paddingVertical: 17 * k, borderRadius: 18 * k },
              ]}
            >
              <Image source={megapotDark} resizeMode="contain" style={{ width: 210 * k, height: 46 * k }} />
            </View>
          )}
        </>
      ) : (
        <>
          {logoWhite && (
            <Image
              source={logoWhite}
              resizeMode="contain"
              style={[
                styles.abs,
                { top: (ART_H / 2 - 190) * k, left: ((ART_W - 180) / 2) * k, width: 180 * k, height: 50 * k },
              ]}
            />
          )}
          <Text
            style={[
              styles.abs,
              styles.center,
              {
                top: (ART_H / 2 - 78) * k,
                width: w,
                fontFamily: bodyFont,
                fontSize: 24 * k,
                letterSpacing: 10 * k,
                color: '#fff',
                textShadowColor: '#5A1002',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 7 * k,
              },
            ]}
          >
            MYSTERY PACK
          </Text>
          {megapotDark && (
            <View
              style={[
                styles.plate,
                { top: (ART_H / 2 + 16) * k, left: ((ART_W - 176) / 2) * k, width: 176 * k, paddingVertical: 12 * k, borderRadius: 12 * k },
              ]}
            >
              <Image source={megapotDark} resizeMode="contain" style={{ width: 130 * k, height: 28 * k }} />
            </View>
          )}
          <Text
            style={[
              styles.abs,
              styles.center,
              { top: (ART_H - 112) * k, width: w, fontFamily: bodyFont, fontSize: 18 * k, letterSpacing: 3 * k, color: '#fff', opacity: 0.6 },
            ]}
          >
            1 ENTRY MINIMUM · NO PURCHASE VALUE
          </Text>
        </>
      )}

      {/* gloss sweep */}
      {shine > 0 && shine < 1 && (
        <View
          pointerEvents="none"
          style={[
            styles.abs,
            {
              top: 0,
              height: h,
              width: w * 0.38,
              left: w * (-0.4 + shine * 1.6),
              backgroundColor: 'rgba(255,255,255,0.16)',
              transform: [{ skewX: '-16deg' }],
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pack: {
    overflow: 'hidden',
    backgroundColor: '#FF6A00',
    shadowColor: '#FF3C00',
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 26 },
    elevation: 16,
  },
  abs: { position: 'absolute' },
  center: { textAlign: 'center' },
  plate: { position: 'absolute', backgroundColor: '#FFFDF7', alignItems: 'center', justifyContent: 'center' },
});
