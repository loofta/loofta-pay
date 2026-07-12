import { ChevronRight, Ticket } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { color, radius, space } from '../../lib/theme';
import { FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD } from '../../lib/fonts';
import { StatusChip, type StatusChipTone } from './StatusChip';

export function TicketRow({
  title,
  subtitle,
  statusLabel,
  statusTone,
  amountLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: StatusChipTone;
  amountLabel: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <View style={styles.iconCircle}>
        <Ticket size={16} color={color.brandOrange} />
      </View>
      <View style={styles.middle}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <View style={styles.right}>
        <StatusChip label={statusLabel} tone={statusTone} />
        <Text style={styles.amount}>{amountLabel}</Text>
      </View>
      {onPress && <ChevronRight size={20} color={color.fg3} style={styles.chevron} />}
    </View>
  );

  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[3], gap: space[3] },
  iconCircle: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,74,38,0.14)', alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1 },
  title: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  subtitle: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 13, marginTop: 3 },
  right: { alignItems: 'flex-end', gap: 6 },
  amount: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 15, fontVariant: ['tabular-nums'] },
  chevron: { marginLeft: space[1] },
});
