/**
 * On-device language choice — null means "never picked", which is what gates the first-use
 * language picker in app/_layout.tsx. Same expo-secure-store pattern as tapHighScore.ts.
 */
import * as SecureStore from 'expo-secure-store';
import { isLanguageCode, type LanguageCode } from '../i18n/locales';

const LANGUAGE_KEY = 'language_preference';

export async function getLanguagePreference(): Promise<LanguageCode | null> {
  const raw = await SecureStore.getItemAsync(LANGUAGE_KEY);
  return isLanguageCode(raw) ? raw : null;
}

export async function setLanguagePreference(code: LanguageCode): Promise<void> {
  await SecureStore.setItemAsync(LANGUAGE_KEY, code);
}
