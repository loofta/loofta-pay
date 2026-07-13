import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { LANGUAGES, type LanguageCode } from '../lib/i18n/locales';
import { useTranslation } from '../lib/i18n/LanguageProvider';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY_SEMIBOLD, FONT_TITLE_SEMIBOLD } from '../lib/fonts';

export function LanguageModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { language, setLanguage, t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t.languageModalTitle}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
              <X size={18} color={color.fg3} />
            </TouchableOpacity>
          </View>

          <View style={styles.list}>
            {LANGUAGES.map((lang) => {
              const active = lang.code === language;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => {
                    setLanguage(lang.code as LanguageCode);
                    onClose();
                  }}
                >
                  <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{lang.nativeLabel}</Text>
                  {active && <Check size={18} color={color.brandOrange} />}
                </TouchableOpacity>
              );
            })}
          </View>
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
  list: { gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.md,
    backgroundColor: color.surface1,
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  rowLabel: { color: color.fg2, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 16 },
  rowLabelActive: { color: color.fg },
});
