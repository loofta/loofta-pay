import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type DashboardActivity = {
  key: string;
  sent: boolean;
  title: string;
  sub: string;
  amount: number;
  created_at: string;
  href: string;
};

type DashboardCache = {
  /** Whose snapshot this is; a different user wipes it so nobody ever sees someone else's numbers. */
  userId: string | null;
  balanceUsd: number | null;
  recent: DashboardActivity[];
  weeklyVolumeUsd: number;
  weekStart: number;
  /** Entries in the next draw and when it happens, so the card renders instantly on reopen. */
  entries: number | null;
  nextDrawAt: string | null;
  update: (userId: string, patch: Partial<Omit<DashboardCache, "userId" | "update" | "reset">>) => void;
  reset: () => void;
};

const empty = { userId: null, balanceUsd: null, recent: [], weeklyVolumeUsd: 0, weekStart: 0, entries: null, nextDrawAt: null };

/**
 * Last known dashboard numbers, persisted to localStorage. The live queries (RPC balance, history,
 * draw status) stay the source of truth; this only fills the gaps while they load or fail, so the
 * home card never flashes $0.00 or an empty list.
 */
export const useDashboardStore = create<DashboardCache>()(
  persist(
    (set, get) => ({
      ...empty,
      update: (userId, patch) => {
        const cur = get();
        const base = cur.userId === userId ? cur : { ...cur, ...empty, userId };
        set({ ...base, ...patch, userId });
      },
      reset: () => set({ ...empty }),
    }),
    {
      name: "loofta.dashboard.v1",
      storage: createJSONStorage(() => (typeof window === "undefined"
        ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
        : localStorage)),
      partialize: (s) => ({ userId: s.userId, balanceUsd: s.balanceUsd, recent: s.recent, weeklyVolumeUsd: s.weeklyVolumeUsd, weekStart: s.weekStart, entries: s.entries, nextDrawAt: s.nextDrawAt }),
    },
  ),
);
