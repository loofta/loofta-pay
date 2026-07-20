export interface SocialPlatform {
  id: "discord" | "github" | "telegram";
  name: string;
  idLabel: string;
  placeholder: string;
}

/**
 * Telegram login is currently broken in production (Privy dashboard misconfiguration — see
 * telegram-relay/page.tsx). Hidden from every "send to a new platform handle" picker until
 * that's fixed, without touching the claim side for payments already pending on Telegram.
 * Defaults enabled everywhere (local/preview keep working for debugging); set
 * NEXT_PUBLIC_TELEGRAM_ENABLED=false on the Vercel PRODUCTION environment specifically to
 * disable it there, and flip it back once the Privy dashboard issue is fixed.
 */
export const TELEGRAM_SEND_ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_ENABLED !== "false";

/** Platforms selectable in the send flow's platform picker (see PlatformSelect in app/page.tsx). */
export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { id: "discord", name: "Discord", idLabel: "Discord username", placeholder: "username" },
  { id: "github", name: "GitHub", idLabel: "GitHub username", placeholder: "username" },
  ...(TELEGRAM_SEND_ENABLED
    ? [{ id: "telegram" as const, name: "Telegram", idLabel: "Telegram username", placeholder: "username" }]
    : []),
];

export function getSocialPlatform(id: string): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((p) => p.id === id);
}
