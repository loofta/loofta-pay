import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const locales = ['en', 'pt-BR', 'fr', 'de', 'it', 'tr', 'zh-CN', 'ko', 'ja', 'id', 'fil', 'vi', 'ar', 'hi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

function detectFromAcceptLanguage(acceptLanguage: string): Locale {
  // Parse into entries sorted by q-value (highest priority first).
  // e.g. "vi-VN,vi;q=0.9,fr-FR;q=0.1" → [vi-VN(1.0), vi(0.9), fr-FR(0.1)]
  const entries = acceptLanguage
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    if (tag.startsWith('pt')) return 'pt-BR';
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('de')) return 'de';
    if (tag.startsWith('it')) return 'it';
    if (tag.startsWith('tr')) return 'tr';
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('id')) return 'id';
    if (tag === 'fil' || tag.startsWith('fil-') || tag === 'tl' || tag.startsWith('tl-')) return 'fil';
    if (tag.startsWith('vi')) return 'vi';
    if (tag.startsWith('ar')) return 'ar';
    if (tag.startsWith('hi')) return 'hi';
  }
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

  const messages = await import(`@/messages/${locale}.json`)
    .catch(() => import('@/messages/en.json'));

  return {
    locale,
    messages: messages.default,
  };
});
