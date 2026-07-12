import { StyleSheet, Text, View } from 'react-native';
import { color } from '../../lib/theme';
import { FONT_BODY_BOLD } from '../../lib/fonts';

export function TicketNumberRow({ main, bonus }: { main: number[]; bonus: number }) {
  return (
    <View style={styles.row}>
      {main.map((m, i) => (
        <View key={i} style={styles.numberBubble}>
          <Text style={styles.numberBubbleText}>{m}</Text>
        </View>
      ))}
      <View style={styles.bonusBubble}>
        <Text style={styles.bonusBubbleText}>{bonus}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  numberBubble: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surface3, alignItems: 'center', justifyContent: 'center' },
  numberBubbleText: { color: color.fg, fontFamily: FONT_BODY_BOLD, fontSize: 18 },
  bonusBubble: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.brandOrange, alignItems: 'center', justifyContent: 'center' },
  bonusBubbleText: { color: color.bgInk, fontFamily: FONT_BODY_BOLD, fontSize: 18 },
});
