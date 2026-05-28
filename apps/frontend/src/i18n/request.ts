import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const locales = ['en', 'pt-BR', 'fr', 'de', 'it', 'tr', 'zh-CN', 'ko', 'ja', 'id', 'fil', 'vi', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

function detectFromAcceptLanguage(acceptLanguage: string): Locale {
  const normalized = acceptLanguage.toLowerCase();
  if (normalized.includes('pt')) return 'pt-BR';
  if (normalized.includes('fr')) return 'fr';
  if (normalized.includes('de')) return 'de';
  if (normalized.includes('it')) return 'it';
  if (normalized.includes('tr')) return 'tr';
  if (normalized.includes('zh')) return 'zh-CN';
  if (normalized.includes('ko')) return 'ko';
  if (normalized.includes('ja')) return 'ja';
  if (normalized.includes('id')) return 'id';
  if (normalized.includes('fil') || normalized.includes('tl')) return 'fil';
  if (normalized.includes('vi')) return 'vi';
  if (normalized.includes('ar')) return 'ar';
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined;

  let locale: Locale = defaultLocale;

  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = (await headers()).get('accept-language') ?? '';
    locale = detectFromAcceptLanguage(acceptLanguage);
  }

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
