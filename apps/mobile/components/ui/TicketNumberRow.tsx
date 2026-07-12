import { StyleSheet, Text, View } from 'react-native';
import { color } from '../../lib/theme';
import { FONT_BODY_MEDIUM } from '../../lib/fonts';

export function TicketNumberRow({ main, bonus }: { main: number[]; bonus: number }) {
  return (
    <View style={styles.row}>
      {main.map((m) => (
        <View key={m} style={styles.numberBubble}>
          <Text style={styles.numberBubbleText}>{m}</Text>
        </View>
      ))}
      <View style={styles.divider} />
      <View style={styles.bonusBubble}>
        <Text style={styles.bonusBubbleText}>{bonus}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  numberBubble: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.surface3, alignItems: 'center', justifyContent: 'center' },
  numberBubbleText: { color: color.fg, fontFamily: FONT_BODY_MEDIUM, fontSize: 13 },
  divider: { width: 1, height: 18, backgroundColor: color.borderSoft, marginHorizontal: 2 },
  bonusBubble: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.fg, alignItems: 'center', justifyContent: 'center' },
  bonusBubbleText: { color: color.bgInk, fontFamily: FONT_BODY_MEDIUM, fontSize: 13 },
});
