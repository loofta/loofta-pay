// MegapotTicket.tsx — the vertical entry ticket, react-native-svg + RN text. Brought in from the
// designer's React Native handoff (react-native/MegapotTicket.tsx.txt) verbatim.
//
//   <MegapotTicket width={180} entries={5} />
//
// Deps: react-native-svg (already a dependency)

import React from 'react';
import { View, Text, Image, StyleSheet, ImageSourcePropType } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Line } from 'react-native-svg';
import { FONT_TITLE_SEMIBOLD, FONT_BODY_SEMIBOLD } from '../lib/fonts';

export const TICKET_W = 420;
export const TICKET_H = 880;

type Props = {
  width: number;
  entries?: number;
  logo?: ImageSourcePropType; // dark loofta mark
  jackpotLabel?: string;
  displayFont?: string;
  bodyFont?: string;
};

export default function MegapotTicket({
  width,
  entries = 1,
  logo,
  jackpotLabel = '$1.1M',
  displayFont = FONT_TITLE_SEMIBOLD,
  bodyFont = FONT_BODY_SEMIBOLD,
}: Props) {
  const w = width,
    h = (width * TICKET_H) / TICKET_W,
    k = w / TICKET_W;

  return (
    <View style={[styles.wrap, { width: w, height: h, borderRadius: 30 * k }]}>
      <Svg width={w} height={h} viewBox={`0 0 ${TICKET_W} ${TICKET_H}`}>
        <Defs>
          <LinearGradient id="tg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FF1301" />
            <Stop offset="1" stopColor="#EAB308" />
          </LinearGradient>
        </Defs>
        <Rect width={TICKET_W} height={TICKET_H} fill="#FFFDF7" />
        <Rect width={TICKET_W} height={14} fill="url(#tg)" />
        <Rect x={150} y={490} width={120} height={8} rx={4} fill="url(#tg)" />
        {/* perforation */}
        <Line
          x1={22}
          y1={646}
          x2={398}
          y2={646}
          stroke="#0B0B0F"
          strokeOpacity={0.22}
          strokeWidth={3}
          strokeDasharray="9 11"
          strokeLinecap="round"
        />
        {/* notches */}
        <Circle cx={0} cy={646} r={22} fill="#08060A" />
        <Circle cx={TICKET_W} cy={646} r={22} fill="#08060A" />
        {/* stub */}
        <Rect y={646} width={TICKET_W} height={TICKET_H - 646} fill="url(#tg)" />
      </Svg>

      {logo && (
        <Image source={logo} resizeMode="contain" style={[styles.abs, { top: 118 * k, left: 110 * k, width: 200 * k, height: 56 * k }]} />
      )}
      <Text
        style={[
          styles.abs,
          styles.center,
          { top: 216 * k, width: w, fontFamily: displayFont, fontSize: 260 * k, lineHeight: 260 * k, color: '#0B0B0F' },
        ]}
      >
        {String(entries).padStart(2, '0')}
      </Text>
      <Text
        style={[styles.abs, styles.center, { top: 540 * k, width: w, fontFamily: bodyFont, fontSize: 20 * k, letterSpacing: 7 * k, color: '#6B6B78' }]}
      >
        {entries === 1 ? 'ENTRY' : 'ENTRIES'}
      </Text>
      <Text style={[styles.abs, styles.center, { top: 722 * k, width: w, fontFamily: displayFont, fontSize: 70 * k, color: '#fff' }]}>
        {jackpotLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  abs: { position: 'absolute' },
  center: { textAlign: 'center' },
});
