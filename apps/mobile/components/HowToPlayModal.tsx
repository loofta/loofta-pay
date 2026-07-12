import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY, FONT_BODY_SEMIBOLD, FONT_TITLE_SEMIBOLD } from '../lib/fonts';
import { PrimaryButton } from './ui/PrimaryButton';

const STEPS: { title: string; body: string }[] = [
  { title: '1. Pick your numbers', body: 'Choose 5 numbers (1–30) plus a bonus (1–12), or let us pick them randomly.' },
  { title: '2. Pay privately', body: 'Tickets are $1 each, paid from your Seeker wallet and shielded via MagicBlock. Buy as many as you like.' },
  { title: '3. Daily draw', body: 'A draw happens every day. The more of your numbers match, the bigger the prize.' },
  { title: '4. Collect your win', body: 'Small wins come back as a free ticket to play again (no fees). Bigger wins can be redeemed privately to your wallet.' },
];

export function HowToPlayModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>How to play</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
              <X size={18} color={color.fg3} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.bodyContent}>
            {STEPS.map((s) => (
              <View key={s.title} style={styles.step}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
              </View>
            ))}
          </ScrollView>

          <PrimaryButton label="Got it" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.bgInkSoft,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[6],
    paddingTop: space[3],
    paddingBottom: space[8],
    maxHeight: '80%',
    gap: space[4],
  },
  grabber: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space[2] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 20 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface3,
  },
  bodyContent: { gap: space[4], paddingBottom: space[2] },
  step: { gap: 4 },
  stepTitle: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  stepBody: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 16, lineHeight: 22 },
});
