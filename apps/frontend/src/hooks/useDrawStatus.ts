"use client";

import { useQuery } from "@tanstack/react-query";

type Ticket = { status: string; numTickets: number; roundId: string | null };
type Dash = { activeTickets?: Ticket[]; nextDraw?: { roundId: string | null; drawTime: string | null; prizePool?: string | null } };

const IN_DRAW = new Set(["sent", "bridging", "buying", "active"]);

/** How many entries the user has in the next daily draw, and when it happens. */
export function useDrawStatus(opts: { userId?: string; enabled: boolean; getAccessToken: () => Promise<string | null> }) {
  return useQuery({
    queryKey: ["draw-status", opts.userId],
    enabled: opts.enabled && !!opts.userId,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
    queryFn: async () => {
      const token = await opts.getAccessToken().catch(() => null);
      const res = await fetch("/api/lottery/dashboard", { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!res.ok) throw new Error("draw-status");
      const d = (await res.json()) as Dash;
      const roundId = d.nextDraw?.roundId ?? null;
      const entries = (d.activeTickets ?? [])
        .filter((t) => IN_DRAW.has(t.status) && (!t.roundId || !roundId || t.roundId === roundId))
        .reduce((n, t) => n + (Number(t.numTickets) || 1), 0);
      return { entries, drawTime: d.nextDraw?.drawTime ?? null, prizePool: d.nextDraw?.prizePool ?? null };
    },
  });
}
