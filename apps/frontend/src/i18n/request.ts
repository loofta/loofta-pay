import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['en', 'pt-BR', 'fr', 'de', 'it', 'tr', 'zh-CN', 'ko', 'ja', 'id', 'fil', 'vi', 'ar', 'hi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

// Plain dynamic import — Node/webpack already cache the module per running process, and a fresh
// deploy naturally picks up new content. Do NOT wrap this in unstable_cache: its Data Cache is
// explicitly designed to persist *across deployments* on Vercel (no revalidateTag ever fires
// here), so editing a messages/*.json file would silently keep serving the old translations in
// production until someone manually purges the Data Cache. See .claude/skills/i18n-translations.
async function loadMessages(locale: Locale) {
  const messages = await import(`@/messages/${locale}.json`)
    .catch(() => import('@/messages/en.json'));
  return messages.default;
}

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
