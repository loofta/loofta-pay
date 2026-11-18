import { api } from "@/trade/lib/api";
import { getWebApp } from "@/trade/lib/telegram";

export type RewardBadge = { id: string; title: string; hint: string; earned: boolean; done: number; total: number };

export type RewardsSummary = {
  inviteLink: string;
  inviteCode: string;
  invited: boolean;
  invites: { total: number; traded: number };
  discount: { percent: number; active: boolean; feeBps: number; baseFeeBps: number };
  badges: RewardBadge[];
  week: { startsAt: string; endsAt: string; volumeUsd: number; trades: number; rank: number | null };
};

export type LeaderRow = { rank: number; name: string; volumeUsd: number; trades: number; you: boolean };
export type Leaderboard = { startsAt: string; endsAt: string; rows: LeaderRow[] };

export const fetchRewards = (token: string | null) => api<RewardsSummary>("/mini/rewards", { token });
export const fetchLeaderboard = (token: string | null) => api<Leaderboard>("/mini/rewards/leaderboard", { token });
export type CalloutSummary = {
  sharePercent: number;
  pendingUsd: number;
  paidUsd: number;
  tails: number;
  tailers: number;
  tailedVolumeUsd: number;
  recent: Array<{ symbol: string; icon: string | null; amountUsd: number; at: string; status: string }>;
};
export const fetchCallouts = (token: string | null) => api<CalloutSummary>("/mini/rewards/callouts", { token });
/** Tail a holder's post: for the next 24 hours your buys of that coin earn the poster a share of the fee. */
export const tailPost = (postId: string, token: string | null) => api<{ ok: boolean; mint: string; expiresAt: string }>("/mini/rewards/tail", { body: { postId }, token });

export const claimReferral = (code: string, token: string | null) => api<{ ok: boolean; already: boolean }>("/mini/rewards/referral", { body: { code }, token });

/** Tell the backend a trade it built has been signed and sent, so it counts. Never throws: rewards must not get in the way of a trade. */
export async function reportTrade(tradeId: string | null | undefined, signature: string, token: string | null) {
  if (!tradeId) return;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await api<{ ok: boolean; retry?: boolean }>("/mini/rewards/trade", { body: { tradeId, signature }, token });
      if (r.ok || !r.retry) return;
    } catch {
      return;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** What was picked, so the feed can say it. Only ids go to the backend, it looks up the names itself. */
export type PredictionPick = { marketId: string; side: "yes" | "no" };

export async function reportPrediction(signature: string, picks: PredictionPick[], token: string | null) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await api<{ ok: boolean; retry?: boolean }>("/mini/rewards/predict", { body: { signature, picks }, token });
      if (r.ok || !r.retry) return;
    } catch {
      return;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** The invite code this launch came from: Telegram's start parameter, or ?startapp= in a plain browser. */
export function startInviteCode(): string | null {
  if (typeof window === "undefined") return null;
  const wa = getWebApp() as unknown as { initDataUnsafe?: { start_param?: string } } | null;
  const params = new URLSearchParams(window.location.search);
  const raw = wa?.initDataUnsafe?.start_param || params.get("tgWebAppStartParam") || params.get("startapp") || "";
  const m = /^ref_([a-z0-9]{6,12})$/i.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

export const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
