import { StyleSheet, Text, View } from 'react-native';
import { color, radius } from '../../lib/theme';
import { FONT_BODY_BOLD } from '../../lib/fonts';

/** One HRS/MIN/SEC digit box — extracted from the Buy screen's prize-pool countdown. */
export function CountdownTile({ value, label, showColon }: { value: string; label: string; showColon?: boolean }) {
  return (
    <View style={styles.wrap}>
      {showColon && <Text style={styles.colon}>:</Text>}
      <View style={styles.col}>
        <View style={styles.box}>
          <Text style={styles.digit}>{value}</Text>
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end' },
  colon: { color: color.fg4, fontWeight: '700', fontSize: 18, paddingBottom: 16, marginHorizontal: 2 },
  col: { alignItems: 'center' },
  box: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: color.surface3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', alignItems: 'center', justifyContent: 'center' },
  digit: { color: color.fg, fontSize: 24, fontFamily: FONT_BODY_BOLD, fontVariant: ['tabular-nums'] },
  label: { color: color.fg4, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6 },
});
