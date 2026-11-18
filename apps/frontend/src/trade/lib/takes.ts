import { api } from "@/trade/lib/api";
import type { PublicAvatar } from "@/trade/lib/feed";
import { getWebApp } from "@/trade/lib/telegram";

/** Smallest bag, in dollars, that lets someone post a take. The backend enforces it, this is only for the wording. */
export const MIN_TAKE_USD = 2;

export type PublicProfile = {
  handle: string;
  avatar: PublicAvatar;
  joinedAt: string | null;
  shareActivity: boolean;
  showPnl: boolean;
  /** null when the person does not share their activity. */
  stats: { volumeUsd: number; trades: number; buys: number; sells: number; coins: number; predictions: number; predictedUsd: number; biggestUsd: number } | null;
  topCoins: Array<{ mint: string; symbol: string; icon: string | null; volumeUsd: number }>;
  takes: Array<{ id: string; mint: string; symbol: string; icon: string | null; text: string; createdAt: string }>;
};

export type CallPreview = {
  id: string;
  mint: string;
  name: string;
  avatar: PublicAvatar;
  text: string;
  symbol: string;
  coinName: string | null;
  icon: string | null;
  change24h: number | null;
  heldUsd: number | null;
  createdAt: string;
};

export const fetchUser = (handle: string) => api<PublicProfile>(`/mini/feed/user/${encodeURIComponent(handle.replace(/^@/, ""))}`);
export const fetchCall = (id: string) => api<CallPreview>(`/mini/feed/call/${encodeURIComponent(id)}`);

/** The link people share. It is a plain web page so Telegram can show a preview card, and it opens the app on the coin. */
export function callLink(id: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${origin}/call/${id}`;
}

/** The call this launch came from: Telegram's start parameter (call_<id>), or ?startapp= in a plain browser. */
export function startCallId(): string | null {
  if (typeof window === "undefined") return null;
  const wa = getWebApp() as unknown as { initDataUnsafe?: { start_param?: string } } | null;
  const params = new URLSearchParams(window.location.search);
  const raw = wa?.initDataUnsafe?.start_param || params.get("tgWebAppStartParam") || params.get("startapp") || "";
  const m = /^call_([0-9a-f-]{36})$/i.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

/** Opens Telegram's share picker with the call link, so it can go to a channel or a group with its preview card. */
export function shareCallUrl(id: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(callLink(id))}&text=${encodeURIComponent(text)}`;
}
