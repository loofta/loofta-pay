import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getLanguagePreference, setLanguagePreference } from '../storage/languagePreference';
import { LOCALE_TAG, TRANSLATIONS, type LanguageCode, type Translations } from './locales';

interface LanguageContextValue {
  /** Ready once the stored preference has been read from SecureStore. */
  ready: boolean;
  /** Null only until a first-time user picks one — app/_layout.tsx gates on this to show the
   *  first-use language picker instead of the app. */
  language: LanguageCode | null;
  /** BCP-47 tag for the active language, for Intl/toLocaleString number & date formatting. */
  localeTag: string;
  t: Translations;
  setLanguage: (code: LanguageCode) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<LanguageCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getLanguagePreference();
      if (!cancelled) {
        setLanguageState(stored);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    void setLanguagePreference(code);
  }, []);

  const active = language ?? 'en';

  return (
    <LanguageContext.Provider
      value={{
        ready,
        language,
        localeTag: LOCALE_TAG[active],
        t: TRANSLATIONS[active],
        setLanguage,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useTranslation must be used within a LanguageProvider');
  return ctx;
}
