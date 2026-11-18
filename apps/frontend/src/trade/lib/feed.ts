import { api } from "@/trade/lib/api";
import type { CoinRef } from "@/trade/lib/coin";

export type AvatarColor = "orange" | "green" | "blue" | "purple" | "pink" | "gold" | "teal" | "red";
export const AVATAR_COLORS: AvatarColor[] = ["orange", "green", "blue", "purple", "pink", "gold", "teal", "red"];

export type PublicAvatar = { kind: "image" | "color"; url: string | null; color: AvatarColor };

type Author = { name: string; avatar: PublicAvatar };
export type CoinCard = { mint: string; symbol: string; name: string; icon: string | null; decimals: number; usd: number | null; mcap: number | null; change24h: number | null };

export type CommentPost = Author & {
  type: "comment";
  id: string;
  coin: CoinCard;
  text: string;
  holdingPct: number | null;
  replyCount: number;
  /** The poster's newest update on this post. The card shows the original post with this under it. */
  update: { text: string; createdAt: string } | null;
  position: { amount: number; usd: number | null } | null;
  pnl: { usd: number; pct: number } | null;
  createdAt: string;
};
export type PredictionPost = Author & { type: "prediction"; id: string; title: string; detail: string; amountUsd: number; eventId: string | null; image: string | null; createdAt: string };
export type TradePost = Author & { type: "trade"; id: string; coin: CoinCard; amountUsd: number; createdAt: string };
export type FeedPost = CommentPost | PredictionPost | TradePost;

export type MiniProfile = {
  name: string;
  handle: string | null;
  avatar: PublicAvatar;
  showPnl: boolean;
  hideName: boolean;
  shareActivity: boolean;
  options: { telegram: string | null; twitter: string | null; telegramName: string | null };
};

export const fetchFeed = (before?: string | null) => api<{ posts: FeedPost[]; next: string | null }>(`/mini/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`);
export const fetchProfile = (token: string | null) => api<MiniProfile>("/mini/feed/profile", { token });
export const saveProfile = (body: { avatar?: "telegram" | "twitter" | "color"; color?: AvatarColor; showPnl?: boolean; shareActivity?: boolean; handle?: string; shuffleHandle?: boolean; useTelegramName?: boolean }, token: string | null) =>
  api<MiniProfile>("/mini/feed/profile", { body, token });

/** The coin a post is about, in the shape the coin page opens with. */
export const coinFromPost = (p: CommentPost | TradePost): CoinRef => ({
  mint: p.coin.mint,
  symbol: p.coin.symbol,
  name: p.coin.name,
  icon: p.coin.icon,
  decimals: p.coin.decimals,
  usd: p.coin.usd,
  mcap: p.coin.mcap,
  change: p.coin.change24h,
});

/** Gradient behind a colour avatar. */
export const AVATAR_GRADIENT: Record<AvatarColor, string> = {
  orange: "linear-gradient(135deg,#ff7a2a,#e04a0a)",
  green: "linear-gradient(135deg,#4ccb86,#2f9e60)",
  blue: "linear-gradient(135deg,#4aa8ff,#2564d9)",
  purple: "linear-gradient(135deg,#a77bff,#6b3fd6)",
  pink: "linear-gradient(135deg,#ff7bc0,#d63f8c)",
  gold: "linear-gradient(135deg,#ffd45c,#e0a30a)",
  teal: "linear-gradient(135deg,#3fd6c6,#1f9a8c)",
  red: "linear-gradient(135deg,#ff7b6c,#e8453a)",
};

/** Cuts a picked file to a 256px square JPEG, small enough to send and store, and returns it as a data URL. */
export async function squareThumb(file: File, size = 256): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Pick a picture file.");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that picture.");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
export const uploadAvatar = (image: string, token: string | null) => api<MiniProfile>("/mini/feed/profile/avatar", { body: { image }, token });
