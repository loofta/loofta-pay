"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAmpleEvmOverview, getAmpleEvmStatus, getAmpleOverview, getAmpleStatus } from "@/services/api/ample";
import { compactUsd, pct, useAmpleStats } from "./useAmpleStats";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const GOLD = "#FF7A2A";

/**
 * Compact home entry for staking. One tappable row, sized for a phone.
 * Shows what you already staked once you have a stake, otherwise the pitch.
 */
export function StakeHomeCard() {
  const { authenticated, userId, getAccessToken } = useAuth();
  const { data: stats } = useAmpleStats();

  // Savings can sit in the new pool, the old one, or both. The card adds them up.
  const me = useQuery({
    queryKey: ["ample-me", userId],
    enabled: authenticated && !!userId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const o = { userId: userId ?? undefined, accessToken: await getAccessToken().catch(() => null) };
      const read = async (status: () => Promise<{ enabled: boolean; linked: boolean }>, overview: () => Promise<any>) => {
        try {
          const st = await status();
          return st.enabled && st.linked ? await overview() : null;
        } catch {
          return null;
        }
      };
      const [sol, evm] = await Promise.all([
        read(() => getAmpleStatus(o), () => getAmpleOverview(o)),
        read(() => getAmpleEvmStatus(o), () => getAmpleEvmOverview(o)),
      ]);
      const list = [sol, evm].filter(Boolean) as any[];
      const usd = list.reduce((a, ov) => a + (ov.balances ?? []).reduce((x: number, b: any) => x + (b?.usdMicro && /^\d+$/.test(b.usdMicro) ? Number(b.usdMicro) / 1e6 : 0), 0), 0);
      const tickets = list.reduce((a, ov) => a + (ov.tickets?.totalTickets !== undefined ? Math.floor(Number(ov.tickets.totalTickets)) : 0), 0);
      const claimable = list.reduce((a, ov) => a + (ov.claimable?.length ?? 0), 0);
      return { usd, tickets, claimable };
    },
  });

  // Under a cent is leftover dust, not a stake worth announcing.
  const staked = me.data && me.data.usd >= 0.01 ? me.data.usd.toFixed(2) : null;
  const tickets = staked ? me.data?.tickets ?? 0 : 0;
  const claimable = me.data?.claimable ?? 0;

  const title = staked ? `You have $${staked} earning` : "Earn on your dollars, win weekly";
  const sub = claimable > 0
    ? `You have ${claimable} prize${claimable === 1 ? "" : "s"} to claim`
    : staked
      ? `${tickets.toLocaleString()} ticket${tickets === 1 ? "" : "s"} in the weekly draw`
      : stats?.avgApr
        ? `~${pct(stats.avgApr)} a year on average${stats.totalPaidUsd ? ` · ${compactUsd(stats.totalPaidUsd)} paid out` : ""}`
        : "Your deposit stays yours";

  const cta = claimable > 0 ? "Claim your prize →" : staked ? "See your earnings →" : "Add money →";

  return (
    <Link
      href="/stake"
      className="lh-7"
      style={{ color: "inherit", display: "flex", gap: 22, alignItems: "center", padding: 28, borderRadius: 30, background: "linear-gradient(135deg,#2A150C,#16110D 60%)", border: "1px solid rgba(255,90,26,0.28)" }}
    >
      <div style={{ flex: "none", width: 96, height: 96, borderRadius: 30, transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#3A3A44 0%,#1B1B22 55%,#0A0A0D 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.18), inset 0 -8px 14px rgba(0,0,0,0.5), 0 8px 0 #050507, 0 26px 44px rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
        <svg width="64" height="64" viewBox="0 0 40 40" fill="none" aria-hidden>
          <defs>
            <linearGradient id="stk-coin" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFC79A" />
              <stop offset="0.5" stopColor="#FF5A1A" />
              <stop offset="1" stopColor="#D23806" />
            </linearGradient>
          </defs>
          <path d="M8 27v3.5c0 2 5.4 3.5 12 3.5s12-1.5 12-3.5V27" fill="#8A2A06" />
          <ellipse cx="20" cy="27" rx="12" ry="4" fill="url(#stk-coin)" />
          <path d="M8 21v3.5c0 2 5.4 3.5 12 3.5s12-1.5 12-3.5V21" fill="#B33A0A" />
          <ellipse cx="20" cy="21" rx="12" ry="4" fill="url(#stk-coin)" />
          <path d="M8 15v3.5c0 2 5.4 3.5 12 3.5s12-1.5 12-3.5V15" fill="#D44A10" />
          <ellipse cx="20" cy="15" rx="12" ry="4" fill="url(#stk-coin)" />
          <ellipse cx="20" cy="15" rx="7" ry="2" fill="none" stroke="#8A2A06" strokeOpacity="0.5" strokeWidth="1" />
          <path d="M31 4l1.4 3.1L35.5 8.5l-3.1 1.4L31 13l-1.4-3.1L26.5 8.5l3.1-1.4z" fill="#FFC79A" />
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 26, letterSpacing: "-0.04em" }}>{title}</span>
        <span style={{ fontSize: 15, lineHeight: 1.5, color: claimable > 0 ? GOLD : "#B9B3A6", fontWeight: claimable > 0 ? 700 : 400 }}>{sub}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: GOLD }}>{cta}</span>
      </div>
    </Link>
  );
}
