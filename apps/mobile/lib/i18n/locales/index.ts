import en, { type Translations } from './en';
import zh from './zh';
import fr from './fr';
import pt from './pt';
import id from './id';

export type { Translations };

export type LanguageCode = 'en' | 'zh' | 'fr' | 'pt' | 'id';

export const LANGUAGES: { code: LanguageCode; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'zh', label: 'Chinese', nativeLabel: '简体中文' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
];

export const TRANSLATIONS: Record<LanguageCode, Translations> = { en, zh, fr, pt, id };

/** BCP-47 tags for number/date formatting (Intl / toLocaleString), keyed by app language. */
export const LOCALE_TAG: Record<LanguageCode, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  fr: 'fr-FR',
  pt: 'pt-BR',
  id: 'id-ID',
};

export function isLanguageCode(value: string | null | undefined): value is LanguageCode {
  return !!value && Object.prototype.hasOwnProperty.call(TRANSLATIONS, value);
}
