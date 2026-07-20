export interface SocialPlatform {
  id: "discord" | "github" | "telegram";
  name: string;
  idLabel: string;
  placeholder: string;
}

/** Platforms selectable in the send flow's platform picker (see PlatformSelect in app/page.tsx). */
export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { id: "discord", name: "Discord", idLabel: "Discord username", placeholder: "username" },
  { id: "github", name: "GitHub", idLabel: "GitHub username", placeholder: "username" },
  { id: "telegram", name: "Telegram", idLabel: "Telegram username", placeholder: "username" },
];

export function getSocialPlatform(id: string): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((p) => p.id === id);
}
