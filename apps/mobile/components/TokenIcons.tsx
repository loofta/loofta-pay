import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

/** Solana Foundation gradient mark (purple → green), matches web's solana-mark.svg. */
export function SolIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128">
      <Defs>
        <LinearGradient id="solGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#9945FF" />
          <Stop offset="100%" stopColor="#14F195" />
        </LinearGradient>
      </Defs>
      <Path d="M24 90 L100 90 L114 104 L38 104 Z" fill="url(#solGradient)" />
      <Path d="M24 54 L100 54 L114 68 L38 68 Z" fill="url(#solGradient)" />
      <Path d="M38 18 L114 18 L100 32 L24 32 Z" fill="url(#solGradient)" />
    </Svg>
  );
}

/** USDC mark — Circle's brand blue with the "$" glyph. */
export function UsdcIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill="#2775CA" />
      <SvgText x={16} y={22} fontSize={18} fontWeight="700" fill="#fff" textAnchor="middle">$</SvgText>
    </Svg>
  );
}
