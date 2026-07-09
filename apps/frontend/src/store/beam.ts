import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BeamStage = "funding" | "sending" | "error";

export interface BeamActivePayment {
  id: string;
  platform: string;
  identifier: string;
  amountUsdc: number;
  amountPayout: number;
  /** Currency amountPayout is denominated in — USD for Venmo/Cash App, USD or EUR for Revolut. */
  currency: string;
  /** Live USD->currency rate applied when this payment was created (1 for USD). */
  fxRateFromUsd: number;
  baseWalletAddress: string;
  stage: BeamStage;
  label: string;
  errorMsg?: string;
  startedAt: number;
  /** Set once the on-chain ZKP2P deposit has been created — needed to check lock state / cancel. */
  zkp2pDepositId?: string;
}

type BeamState = {
  active: Record<string, BeamActivePayment>;
  upsertActive: (p: BeamActivePayment) => void;
  patchActive: (id: string, patch: Partial<BeamActivePayment>) => void;
  removeActive: (id: string) => void;
};

export const useBeamStore = create<BeamState>()(
  persist(
    (set) => ({
      active: {},
      upsertActive: (p) => set((s) => ({ active: { ...s.active, [p.id]: p } })),
      patchActive: (id, patch) =>
        set((s) => (s.active[id] ? { active: { ...s.active, [id]: { ...s.active[id], ...patch } } } : s)),
      removeActive: (id) =>
        set((s) => {
          if (!(id in s.active)) return s;
          const next = { ...s.active };
          delete next[id];
          return { active: next };
        }),
    }),
    { name: "loofta-beam-active" },
  ),
);
