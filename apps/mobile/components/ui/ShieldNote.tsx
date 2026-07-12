import { ShieldCheck } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { color, space } from '../../lib/theme';
import { FONT_BODY } from '../../lib/fonts';

export function ShieldNote({ text }: { text: string }) {
  return (
    <View style={styles.row}>
      <ShieldCheck size={14} color={color.success} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  text: { color: color.success, fontFamily: FONT_BODY, fontSize: 12, flexShrink: 1 },
});
