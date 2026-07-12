import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import type { TextStyle } from 'react-native';
import { StyleSheet, Text } from 'react-native';

type Point = { x: number; y: number };

/** Gradient-clipped text — used sparingly, only as a text accent per the design spec (never as a
 *  button fill). Defaults to the brand red→yellow gradient, left-to-right. */
export function GradientText({
  children,
  style,
  colors = ['#FF1301', '#EAB308'],
  start = { x: 0, y: 0 },
  end = { x: 1, y: 0 },
}: {
  children: string;
  style?: TextStyle;
  colors?: [string, string, ...string[]];
  start?: Point;
  end?: Point;
}) {
  return (
    <MaskedView maskElement={<Text style={style}>{children}</Text>}>
      <LinearGradient colors={colors} start={start} end={end}>
        <Text style={[style, styles.hidden]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
