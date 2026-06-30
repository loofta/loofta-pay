import { getRequestConfig } from 'next-intl/server';
import { unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';

export const locales = ['en', 'pt-BR', 'fr', 'de', 'it', 'tr', 'zh-CN', 'ko', 'ja', 'id', 'fil', 'vi', 'ar', 'hi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

// Cache parsed message files — they never change at runtime, only on redeploy
const loadMessages = unstable_cache(
  async (locale: Locale) => {
    const messages = await import(`@/messages/${locale}.json`)
      .catch(() => import('@/messages/en.json'));
    return messages.default;
  },
  ['i18n-messages'],
  { revalidate: false }
);

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined;

  const locale: Locale = (cookieLocale && (locales as readonly string[]).includes(cookieLocale))
    ? cookieLocale
    : defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
