import { Check, Languages } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES, isLanguageCode, type LanguageCode } from '../lib/i18n/locales';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY, FONT_TITLE_SEMIBOLD } from '../lib/fonts';
import { Wordmark } from './Wordmark';

/** Best-effort device language guess for the pre-highlighted option below — deliberately reads
 *  from the JS-only Intl API (Hermes ships full ICU) instead of expo-localization, which is a
 *  native module and would require a fresh native build to pick up. Never throws: falls back to
 *  no suggestion at all if Intl is unavailable or the locale can't be parsed. */
function guessDeviceLanguage(): LanguageCode | null {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    const languageSubtag = tag.split('-')[0];
    return isLanguageCode(languageSubtag) ? languageSubtag : null;
  } catch {
    return null;
  }
}

/**
 * Mandatory first-launch step, shown once (app/_layout.tsx gates on a null stored language
 * preference) before the rest of the app renders. Deliberately doesn't use `t.xxx` for its own
 * copy — there's no active language yet at this point, so the prompt below is shown in every
 * supported language at once instead of guessing one.
 */
const PROMPTS = ['Select your language', '选择语言', 'Choisissez votre langue', 'Selecione seu idioma', 'Pilih bahasa'];

/** Selection lingers on-screen this long — enough to register as a deliberate confirmation —
 *  before handing off to the parent's onSelect (which swaps this screen out for the app). */
const SELECT_HOLD_MS = 450;

export function LanguagePickerScreen({ onSelect }: { onSelect: (code: LanguageCode) => void }) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<LanguageCode | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggested = useMemo(guessDeviceLanguage, []);

  const handlePress = (code: LanguageCode) => {
    if (selected) return; // one selection at a time — ignore taps while confirming/transitioning
    setSelected(code);
    timerRef.current = setTimeout(() => onSelect(code), SELECT_HOLD_MS);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[6] }]}>
      <View style={styles.header}>
        <Wordmark width={130} />
        <View style={styles.iconWrap}>
          <Languages size={22} color={color.brandOrange} />
        </View>
        {PROMPTS.map((p) => (
          <Text key={p} style={styles.prompt}>
            {p}
          </Text>
        ))}
      </View>

      <View style={styles.list}>
        {LANGUAGES.map((lang) => {
          const isSelected = lang.code === selected;
          return (
            <TouchableOpacity
              key={lang.code}
              style={[styles.row, lang.code === suggested && styles.rowSuggested, isSelected && styles.rowSelected, selected && !isSelected && styles.rowDimmed]}
              activeOpacity={0.75}
              disabled={!!selected}
              onPress={() => handlePress(lang.code)}
            >
              <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>{lang.nativeLabel}</Text>
              {isSelected && (
                <View style={styles.rowCheck}>
                  <Check size={18} color={color.brandOrange} strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bgInk,
    paddingHorizontal: space[6],
    justifyContent: 'space-between',
    zIndex: 1000,
  },
  header: { alignItems: 'center', gap: space[2] },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[6],
    marginBottom: space[1],
  },
  prompt: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 14, textAlign: 'center' },
  list: { gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: color.surface1,
    paddingVertical: space[5],
  },
  rowSuggested: { borderColor: color.brandOrange },
  rowSelected: { borderColor: color.brandOrange, backgroundColor: 'rgba(255,74,38,0.12)' },
  rowDimmed: { opacity: 0.35 },
  rowLabel: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 18 },
  rowLabelSelected: { color: color.brandOrange },
  rowCheck: { position: 'absolute', right: space[5] },
});
